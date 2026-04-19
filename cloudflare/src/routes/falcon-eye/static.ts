import { Hono } from "hono";
import type { Env } from "../../env";
import { kvDelete, kvGetJSON, kvSetJSON } from "../../lib/kv";

export const feStaticRoutes = new Hono<{ Bindings: Env }>();

// ── Cesium ion token ─────────────────────────────────────────────────────
feStaticRoutes.get("/cesium-token", async (c) => {
  const token = c.env.CESIUM_ION_TOKEN;
  if (!token) return c.json({ token: null, error: "no CESIUM_ION_TOKEN configured" });
  return new Response(JSON.stringify({ token }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=300" },
  });
});

// ── State ─────────────────────────────────────────────────────────────────
const DEFAULT_STATE = { active: false, focus: null, layers: { satellites: true, aircraft: true, cameras: true, news: true }, tracked: null, ts: 0 };

feStaticRoutes.get("/state", async (c) => {
  const data = await kvGetJSON<Record<string, unknown>>(c.env, "falcon-eye", "state");
  return c.json(data || DEFAULT_STATE);
});

feStaticRoutes.post("/state", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const state = { ...DEFAULT_STATE, ...body, ts: Date.now() };
  await kvSetJSON(c.env, "falcon-eye", "state", state);
  return c.json({ ok: true, state });
});

// ── Command pub/sub for the globe UI ──────────────────────────────────────
feStaticRoutes.get("/command", async (c) => {
  const data = await kvGetJSON<{ command?: unknown; ts?: number }>(c.env, "falcon-eye", "pending_command");
  if (data?.command) {
    await kvDelete(c.env, "falcon-eye", "pending_command");
    return c.json(data);
  }
  return c.json({ command: null });
});

feStaticRoutes.post("/command", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (!body.intent) return c.json({ error: "Missing intent" }, 400);
  const command = {
    id: (body.id as string) || crypto.randomUUID(),
    intent: body.intent,
    region: body.region || null,
    lat: typeof body.lat === "number" ? body.lat : null,
    lon: typeof body.lon === "number" ? body.lon : null,
    zoom: typeof body.zoom === "number" ? body.zoom : null,
    query: body.query || null,
    layer: body.layer || null,
    url: body.url || null,
    label: body.label || null,
    ts: Date.now(),
  };
  await kvSetJSON(c.env, "falcon-eye", "pending_command", { command, ts: command.ts });
  return c.json({ ok: true, command });
});

feStaticRoutes.delete("/command", async (c) => {
  await kvDelete(c.env, "falcon-eye", "pending_command");
  return c.json({ ok: true });
});

// ── Custom user-added cameras ─────────────────────────────────────────────
feStaticRoutes.get("/cameras", async (c) => {
  const list = (await kvGetJSON<unknown[]>(c.env, "falcon-eye", "cameras")) || [];
  return c.json(list);
});

feStaticRoutes.post("/cameras", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (!body.url) return c.json({ error: "Missing url" }, 400);
  const list = ((await kvGetJSON<unknown[]>(c.env, "falcon-eye", "cameras")) || []).slice();
  const url = String(body.url);
  const cam = {
    id: (body.id as string) || crypto.randomUUID(),
    url,
    label: (body.label as string) || url,
    lat: typeof body.lat === "number" ? body.lat : null,
    lon: typeof body.lon === "number" ? body.lon : null,
    kind: (body.kind as string) || (url.match(/\.m3u8/i) ? "hls" : url.match(/\.(jpg|mjpg|jpeg)/i) ? "mjpeg" : "iframe"),
    ts: Date.now(),
  };
  list.push(cam);
  await kvSetJSON(c.env, "falcon-eye", "cameras", list);
  return c.json({ ok: true, camera: cam });
});

feStaticRoutes.delete("/cameras", async (c) => {
  const id = c.req.query("id");
  if (!id) {
    await kvSetJSON(c.env, "falcon-eye", "cameras", []);
    return c.json({ ok: true });
  }
  let list = ((await kvGetJSON<{ id: string }[]>(c.env, "falcon-eye", "cameras")) || []).slice();
  list = list.filter((c) => c.id !== id);
  await kvSetJSON(c.env, "falcon-eye", "cameras", list);
  return c.json({ ok: true });
});

// ── NASA FIRMS active fires ──────────────────────────────────────────────
const FIRE_CACHE_MS = 30 * 60 * 1000;

feStaticRoutes.get("/fires", async (c) => {
  // Reuse FIRMS_MAP_KEY if user sets it via wrangler secret
  const KEY = (c.env as unknown as { FIRMS_MAP_KEY?: string }).FIRMS_MAP_KEY;
  if (!KEY) return c.json({ fires: [], note: "no FIRMS_MAP_KEY configured" });
  const cached = await kvGetJSON<{ data: unknown; ts: number }>(c.env, "falcon-eye", "fires");
  if (cached && Date.now() - cached.ts < FIRE_CACHE_MS) return c.json(cached.data);

  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEY}/VIIRS_SNPP_NRT/world/1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return c.json({ fires: [], error: `firms ${res.status}` });
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return c.json({ fires: [] });
    const headers = lines[0].split(",").map((h) => h.trim());
    const idx = (k: string) => headers.indexOf(k);
    const iLat = idx("latitude"), iLon = idx("longitude"), iConf = idx("confidence"), iFrp = idx("frp"), iDate = idx("acq_date"), iTime = idx("acq_time");
    const fires = [];
    const max = Math.min(lines.length - 1, 4000);
    for (let i = 1; i <= max; i++) {
      const f = lines[i].split(",");
      const lat = parseFloat(f[iLat]); const lon = parseFloat(f[iLon]);
      if (isNaN(lat) || isNaN(lon)) continue;
      fires.push({ lat, lon, confidence: f[iConf], frp: parseFloat(f[iFrp]) || 0, date: f[iDate], time: f[iTime] });
    }
    const out = { fires, ts: Date.now() };
    await kvSetJSON(c.env, "falcon-eye", "fires", { data: out, ts: Date.now() });
    return c.json(out);
  } catch (e) {
    return c.json({ fires: [], error: String(e) });
  }
});

// ── NOAA active weather alerts ───────────────────────────────────────────
feStaticRoutes.get("/weather-alerts", async (c) => {
  const cached = await kvGetJSON<{ data: unknown; ts: number }>(c.env, "falcon-eye", "weather-alerts");
  if (cached && Date.now() - cached.ts < 3 * 60 * 1000) return c.json(cached.data);
  try {
    const r = await fetch("https://api.weather.gov/alerts/active", {
      headers: { "User-Agent": "FalconEye/1.0", Accept: "application/geo+json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return c.json({ alerts: [], error: `noaa ${r.status}` });
    const data = (await r.json()) as { features?: { properties?: Record<string, unknown>; geometry?: unknown }[] };
    const alerts = (data.features || []).map((f) => {
      const p = (f.properties || {}) as Record<string, string | undefined>;
      return {
        id: p.id, event: p.event || "", severity: (p.severity || "Unknown").toLowerCase(),
        urgency: p.urgency || "", certainty: p.certainty || "",
        headline: p.headline || p.event || "", description: p.description || "",
        instruction: p.instruction || "", area: p.areaDesc || "",
        effective: p.effective, expires: p.expires, sent: p.sent,
        sender: p.senderName || "", geometry: f.geometry || null,
      };
    });
    const out = { alerts, count: alerts.length, ts: Date.now() };
    await kvSetJSON(c.env, "falcon-eye", "weather-alerts", { data: out, ts: Date.now() });
    return c.json(out);
  } catch (e) {
    return c.json({ alerts: [], error: String(e) });
  }
});

// ── CelesTrak TLE satellite data ─────────────────────────────────────────
const ALLOWED_TLE = new Set(["stations", "active", "weather", "noaa", "goes", "starlink", "gps-ops", "galileo", "glo-ops", "science", "geo", "military"]);

feStaticRoutes.get("/tle", async (c) => {
  const group = (c.req.query("group") || "stations").toLowerCase();
  if (!ALLOWED_TLE.has(group)) return c.json({ error: "group not allowed" }, 400);
  const cached = await kvGetJSON<{ data: unknown; ts: number }>(c.env, "falcon-eye", `tle:${group}`);
  if (cached && Date.now() - cached.ts < 6 * 60 * 60 * 1000) return c.json(cached.data);
  try {
    const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return c.json({ sats: [], error: `CelesTrak ${res.status}` });
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const sats = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
      sats.push({ name: lines[i].trim(), tle1: lines[i + 1], tle2: lines[i + 2] });
    }
    const out = { sats, group, ts: Date.now() };
    await kvSetJSON(c.env, "falcon-eye", `tle:${group}`, { data: out, ts: Date.now() });
    return c.json(out);
  } catch (e) {
    return c.json({ sats: [], error: String(e) });
  }
});

// ── Broadcasts directory ─────────────────────────────────────────────────
const yt = (channelId: string) => `https://www.youtube.com/embed/live_stream?channel=${channelId}&autoplay=1&mute=1`;
const BROADCASTS: Record<string, { name: string; region: string; kind: string; url: string }> = {
  bbc: { name: "BBC News", region: "UK", kind: "iframe", url: yt("UC16niRr50-MSBwiO3YDb3RA") },
  aljazeera: { name: "Al Jazeera English", region: "Qatar", kind: "iframe", url: yt("UCNye-wNBqNL5ZzHSJj3l8Bg") },
  france24: { name: "France 24 English", region: "France", kind: "iframe", url: yt("UCQfwfsi5VrQ8yKZ-UWmAEFg") },
  dw: { name: "DW News", region: "Germany", kind: "iframe", url: yt("UCknLrEdhRCp1aegoMqRaCZg") },
  skynews: { name: "Sky News", region: "UK", kind: "iframe", url: yt("UCoMdktPbSTixAyNGwb-UYkQ") },
  cnn: { name: "CNN", region: "USA", kind: "iframe", url: "https://www.cnn.com/live-tv" },
  ap: { name: "Associated Press", region: "USA", kind: "iframe", url: yt("UCH1oRy1dINbMVp3UFWrKP0w") },
  nhk: { name: "NHK World", region: "Japan", kind: "iframe", url: "https://www3.nhk.or.jp/nhkworld/en/live/" },
  cna: { name: "Channel NewsAsia", region: "Singapore", kind: "iframe", url: yt("UCXcAUwoarMzqZW2RPN3-vTw") },
  abcau: { name: "ABC News Australia", region: "Australia", kind: "iframe", url: yt("UcVgPSjAKqDmkVcqjJDzbe6Q") },
  abcus: { name: "ABC News Live", region: "USA", kind: "iframe", url: yt("UCBi2mrWuNuyYy4gbM6fU18Q") },
  cbs: { name: "CBS News", region: "USA", kind: "iframe", url: yt("UC8p1vwvWtl6T73JiExfWs1g") },
  nbc: { name: "NBC News NOW", region: "USA", kind: "iframe", url: yt("UCeY0bbntWzzVIaj2z3QigXg") },
  reuters: { name: "Reuters", region: "UK", kind: "iframe", url: "https://www.reuters.com/video/" },
  guardian: { name: "The Guardian", region: "UK", kind: "iframe", url: "https://www.theguardian.com/world/series/guardian-live" },
  nyt: { name: "The New York Times", region: "USA", kind: "iframe", url: "https://www.nytimes.com/video" },
  toi: { name: "Times of India", region: "India", kind: "iframe", url: yt("UCttspZesZIDEwwpVIgoZtWQ") },
  wion: { name: "WION", region: "India", kind: "iframe", url: yt("UC_gUM8rL-Lrg6O3adPW9K1g") },
  kyiv: { name: "Kyiv Independent", region: "Ukraine", kind: "iframe", url: "https://kyivindependent.com/" },
  toi_il: { name: "Times of Israel", region: "Israel", kind: "iframe", url: "https://www.timesofisrael.com/" },
  i24: { name: "i24NEWS English", region: "Israel", kind: "iframe", url: yt("UCmkMsJqg-2_KHA46BLNdYNw") },
  euronews: { name: "Euronews English", region: "Europe", kind: "iframe", url: yt("UCSrZ3UV4jOidv8ppoVuvW9Q") },
  bloomberg: { name: "Bloomberg", region: "USA", kind: "iframe", url: yt("UCIALMKvObZNtJ6AmdCLP7Lg") },
};

function matchChannel(input: string): string | null {
  const s = input.toLowerCase();
  if (s.includes("bbc")) return "bbc";
  if (s.includes("guardian")) return "guardian";
  if (s.includes("al jazeera") || s.includes("aljazeera")) return "aljazeera";
  if (s.includes("france 24") || s.includes("france24")) return "france24";
  if (s === "dw" || s.includes("deutsche welle") || s.includes("dw.com") || s.includes("dw news")) return "dw";
  if (s.includes("cnn")) return "cnn";
  if (s.includes("sky news") || s.includes("skynews")) return "skynews";
  if (s.includes("new york times") || s.includes("nytimes") || s === "nyt") return "nyt";
  if (s.includes("reuters")) return "reuters";
  if (s.includes("associated press") || s === "ap" || s.includes("apnews")) return "ap";
  if (s.includes("nhk")) return "nhk";
  if (s.includes("channel news asia") || s.includes("channel newsasia") || s.includes("cna")) return "cna";
  if (s.includes("abc news") && (s.includes("australia") || s.includes("au"))) return "abcau";
  if (s.includes("times of india") || s.includes("timesofindia") || s.includes("toi")) return "toi";
  if (s.includes("kyiv independent")) return "kyiv";
  if (s.includes("times of israel") || s.includes("timesofisrael")) return "toi_il";
  if (s.includes("i24")) return "i24";
  if (s.includes("euronews")) return "euronews";
  if (s.includes("bloomberg")) return "bloomberg";
  if (s.includes("wion")) return "wion";
  if (s.includes("cbs news") || s === "cbsnews" || s.includes("cbsnews.com")) return "cbs";
  if (s.includes("nbc news") || s === "nbcnews" || s.includes("nbcnews.com")) return "nbc";
  if (s.includes("abc news") && !s.includes("australia") && !s.includes("au")) return "abcus";
  return null;
}

feStaticRoutes.get("/broadcasts", (c) => {
  const id = c.req.query("id");
  const source = c.req.query("source");
  if (id && BROADCASTS[id]) return c.json({ id, ...BROADCASTS[id] });
  if (source) {
    const match = matchChannel(source);
    if (match && BROADCASTS[match]) return c.json({ id: match, ...BROADCASTS[match] });
    return c.json({ id: null, error: `no broadcast for source: ${source}` }, 404);
  }
  return c.json({ broadcasts: BROADCASTS, count: Object.keys(BROADCASTS).length });
});

// ── Nature cams (curated static list) ────────────────────────────────────
const NATURE_CAMS = [
  { id: "nasa-iss", label: "ISS Live HD Earth View", lat: 28.5721, lon: -80.6480, kind: "iframe", url: "https://www.ustream.tv/embed/17074538?html5ui=1&autoplay=1", source: "nasa" },
  { id: "nasa-ksc", label: "Kennedy Space Center Live", lat: 28.5721, lon: -80.6480, kind: "iframe", url: "https://www.ustream.tv/embed/9408562?html5ui=1&autoplay=1", source: "nasa" },
  { id: "nasa-jpl", label: "JPL Mission Control Mars", lat: 34.2013, lon: -118.1712, kind: "iframe", url: "https://www.ustream.tv/embed/6540154?html5ui=1&autoplay=1", source: "nasa" },
  { id: "exp-alaska-bears", label: "Alaska Brooks Falls Brown Bears", lat: 58.5546, lon: -155.7800, kind: "iframe", url: "https://explore.org/livecams/brown-bears/brown-bear-salmon-cam-brooks-falls", source: "explore" },
  { id: "exp-africa", label: "Africam — Tembe Elephant Park", lat: -26.9500, lon: 32.4167, kind: "iframe", url: "https://explore.org/livecams/african-wildlife/africam-tembe-elephant-park", source: "explore" },
  { id: "exp-puffins", label: "Puffin Burrow, Maine", lat: 43.8791, lon: -68.8708, kind: "iframe", url: "https://explore.org/livecams/puffins/puffin-burrow-cam", source: "explore" },
  { id: "exp-sea-otters", label: "Monterey Bay Sea Otters", lat: 36.6178, lon: -121.9015, kind: "iframe", url: "https://explore.org/livecams/aquariums/monterey-bay-otter-cam", source: "explore" },
  { id: "exp-sharks", label: "Monterey Bay Kelp Forest", lat: 36.6178, lon: -121.9015, kind: "iframe", url: "https://explore.org/livecams/aquariums/monterey-bay-aquarium-kelp-cam", source: "explore" },
  { id: "exp-pandas", label: "Smithsonian Panda Cam", lat: 38.9296, lon: -77.0500, kind: "iframe", url: "https://explore.org/livecams/zoos/panda-cam", source: "explore" },
  { id: "exp-wolves", label: "International Wolf Center", lat: 47.9028, lon: -91.8655, kind: "iframe", url: "https://explore.org/livecams/wolves/wolf-cam", source: "explore" },
  { id: "exp-bison", label: "Yellowstone Old Faithful", lat: 44.4605, lon: -110.8281, kind: "iframe", url: "https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm", source: "nps" },
  { id: "port-rotterdam", label: "Port of Rotterdam", lat: 51.9497, lon: 4.1333, kind: "iframe", url: "https://www.portofrotterdam.com/en/webcam", source: "ports" },
];

feStaticRoutes.get("/nature-cams", (c) => c.json({ cams: NATURE_CAMS, source: "nature", ts: Date.now() }));
