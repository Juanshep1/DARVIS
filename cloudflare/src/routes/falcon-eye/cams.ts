import { Hono } from "hono";
import type { Env } from "../../env";
import { kvGetJSON, kvSetJSON } from "../../lib/kv";

export const feCamsRoutes = new Hono<{ Bindings: Env }>();

// ── Caltrans DOT cams ────────────────────────────────────────────────────
const CALTRANS_DISTRICTS = ["d3", "d4", "d5", "d6", "d7", "d8", "d10", "d11", "d12"];

async function fetchCaltrans(district: string) {
  try {
    const r = await fetch(`https://cwwp2.dot.ca.gov/data/${district}/cctv/cctvStatus${district.toUpperCase()}.json`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const data = (await r.json()) as { data?: { cctv?: { location?: { latitude?: string; longitude?: string; locationName?: string }; imageData?: { streamingVideoURL?: string; static?: { currentImageURL?: string } }; index?: string } }[] };
    return (data.data || []).map((item) => {
      const cc = item.cctv; if (!cc) return null;
      const loc = cc.location || {};
      const lat = parseFloat(loc.latitude || ""); const lon = parseFloat(loc.longitude || "");
      if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) return null;
      const hls = cc.imageData?.streamingVideoURL;
      const img = cc.imageData?.static?.currentImageURL;
      if (!hls && !img) return null;
      return {
        id: `caltrans-${district}-${cc.index || loc.locationName}`,
        label: `${loc.locationName || "Caltrans CCTV"} (${district.toUpperCase()})`,
        lat, lon,
        kind: hls ? "hls" : "jpg",
        url: hls || img,
        snapshotUrl: img || null,
        source: "caltrans",
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

feCamsRoutes.get("/dot-cams", async (c) => {
  const cached = await kvGetJSON<{ data: unknown; ts: number }>(c.env, "falcon-eye", "dot-cams");
  if (cached && Date.now() - cached.ts < 10 * 60 * 1000) return c.json(cached.data);
  const results = await Promise.allSettled(CALTRANS_DISTRICTS.map(fetchCaltrans));
  const cams = results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])) as unknown[];
  const thin = c.req.query("thin") === "1";
  const out = thin ? cams.filter((_, i) => i % 4 === 0) : cams;
  const payload = { cams: out, total: cams.length, shown: out.length, source: "caltrans", ts: Date.now() };
  await kvSetJSON(c.env, "falcon-eye", "dot-cams", { data: payload, ts: Date.now() });
  return c.json(payload);
});

// ── WSDOT cams ────────────────────────────────────────────────────────────
feCamsRoutes.get("/wsdot-cams", async (c) => {
  const cached = await kvGetJSON<{ data: unknown; ts: number }>(c.env, "falcon-eye", "wsdot-cams");
  if (cached && Date.now() - cached.ts < 10 * 60 * 1000) return c.json(cached.data);
  const accessCode = (c.env as unknown as { WSDOT_ACCESS_CODE?: string }).WSDOT_ACCESS_CODE;
  if (!accessCode) {
    return c.json({ cams: [], total: 0, shown: 0, source: "wsdot", ts: Date.now(), error: "WSDOT_ACCESS_CODE not set" });
  }
  try {
    const r = await fetch(`https://wsdot.wa.gov/traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=${encodeURIComponent(accessCode)}`, { headers: { "User-Agent": "FalconEye/1.0" }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`wsdot ${r.status}`);
    const data = (await r.json()) as { CameraID?: number; IsActive?: boolean; CameraLocation?: { Latitude?: number; Longitude?: number; Description?: string; RoadName?: string; MilePost?: number }; ImageURL?: string; Title?: string }[];
    const cams = data.map((cc) => {
      if (!cc || cc.IsActive === false) return null;
      const loc = cc.CameraLocation || {};
      const lat = Number(loc.Latitude); const lon = Number(loc.Longitude);
      if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) return null;
      const img = cc.ImageURL; if (!img) return null;
      const road = loc.RoadName ? `${loc.RoadName}${loc.MilePost != null ? " @ MP " + loc.MilePost : ""}` : "";
      const title = cc.Title || loc.Description || road || `WSDOT Cam ${cc.CameraID}`;
      return { id: `wsdot-${cc.CameraID}`, label: `${title} (WSDOT)`, lat, lon, kind: "jpg", url: img, snapshotUrl: img, source: "wsdot" };
    }).filter(Boolean) as unknown[];
    const thin = c.req.query("thin") === "1";
    const out = thin ? cams.filter((_, i) => i % 2 === 0) : cams;
    const payload = { cams: out, total: cams.length, shown: out.length, source: "wsdot", ts: Date.now() };
    await kvSetJSON(c.env, "falcon-eye", "wsdot-cams", { data: payload, ts: Date.now() });
    return c.json(payload);
  } catch (e) {
    return c.json({ cams: [], total: 0, shown: 0, source: "wsdot", ts: Date.now(), error: (e as Error).message });
  }
});

// ── USA (OpenTrafficCamMap) ──────────────────────────────────────────────
feCamsRoutes.get("/usa-cams", async (c) => {
  const all = c.req.query("all") === "1";
  const state = c.req.query("state");
  const cacheKey = `usa-cams:${state || "all"}:${all ? "full" : "thin"}`;
  const cached = await kvGetJSON<{ data: unknown; ts: number }>(c.env, "falcon-eye", cacheKey);
  if (cached && Date.now() - cached.ts < 60 * 60 * 1000) return c.json(cached.data);
  try {
    const res = await fetch("https://raw.githubusercontent.com/AidanWelch/OpenTrafficCamMap/master/cameras/USA.json", { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return c.json({ cams: [], error: `github ${res.status}` });
    const data = (await res.json()) as Record<string, Record<string, { latitude?: string | number; longitude?: string | number; url?: string; description?: string; direction?: string; format?: string }[]>>;
    const cams: unknown[] = [];
    for (const [stateName, counties] of Object.entries(data)) {
      if (state && stateName.toLowerCase() !== state.toLowerCase()) continue;
      if (!counties) continue;
      for (const [county, places] of Object.entries(counties)) {
        if (!Array.isArray(places)) continue;
        for (const p of places) {
          const lat = parseFloat(String(p.latitude)); const lon = parseFloat(String(p.longitude));
          if (isNaN(lat) || isNaN(lon) || !p.url) continue;
          const isHls = /\.m3u8/i.test(p.url) || (p.format || "").toUpperCase() === "M3U8";
          cams.push({
            id: `otcm-${stateName}-${county}-${cams.length}`,
            label: `${p.description || "Traffic Cam"} · ${stateName}${p.direction ? " " + p.direction : ""}`,
            lat, lon,
            kind: isHls ? "hls" : "iframe",
            url: p.url,
            state: stateName,
            county,
            source: "usa-dot",
          });
        }
      }
    }
    const out = all ? cams : cams.filter((_, i) => i % 8 === 0);
    const payload = { cams: out, total: cams.length, shown: out.length, source: "OpenTrafficCamMap / USA DOT", ts: Date.now() };
    await kvSetJSON(c.env, "falcon-eye", cacheKey, { data: payload, ts: Date.now() });
    return c.json(payload);
  } catch (e) {
    return c.json({ cams: [], error: String(e) });
  }
});

// ── Curated webcams fallback ─────────────────────────────────────────────
feCamsRoutes.get("/webcams", (c) => {
  // The Netlify function had a large curated list; return a minimal fallback
  // here so the globe still gets landmarks without a 404. The curated list
  // lives in the old Netlify file and can be expanded later if needed.
  const WEBCAMS = [
    { id: "fb-times-square", label: "Times Square, New York", lat: 40.7580, lon: -73.9855, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=tsrobo1" },
    { id: "fb-vegas", label: "Las Vegas Strip", lat: 36.1147, lon: -115.1728, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=lasvegas_strip" },
    { id: "fb-niagara", label: "Niagara Falls", lat: 43.0962, lon: -79.0377, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=niagarafalls_str" },
    { id: "fb-sf-pier", label: "Pier 39, San Francisco", lat: 37.8087, lon: -122.4098, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=pier39" },
    { id: "fb-eiffel", label: "Eiffel Tower, Paris", lat: 48.8584, lon: 2.2945, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/france/ile-de-france/paris/tour-eiffel.html" },
    { id: "fb-london", label: "London Skyline", lat: 51.5074, lon: -0.1278, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/united-kingdom/england/london/london.html" },
    { id: "fb-tokyo-shibuya", label: "Shibuya Crossing, Tokyo", lat: 35.6595, lon: 139.7005, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/japan/kanto/tokyo/shibuya.html" },
  ];
  return c.json({ cams: WEBCAMS, source: "webcams", ts: Date.now() });
});

// ── Insecam (stub — upstream is unstable) ────────────────────────────────
feCamsRoutes.get("/insecam-cams", (c) => {
  // The insecam source requires scraping public IP-cam listings; omit the
  // large static set for Workers-size reasons. Caller can still add custom
  // cams via POST /api/falcon-eye/cameras.
  return c.json({ cams: [], total: 0, returned: 0, source: "insecam", ts: Date.now(), note: "disabled in workers build — use custom cameras" });
});

// ── Cam wall bundler ─────────────────────────────────────────────────────
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

feCamsRoutes.get("/cam-wall", async (c) => {
  const lat = parseFloat(c.req.query("lat") || "39.5");
  const lon = parseFloat(c.req.query("lon") || "-98.35");
  const r = Math.min(parseFloat(c.req.query("r") || "50"), 2000);
  const limit = Math.min(parseInt(c.req.query("limit") || "16"), 64);
  const sources = (c.req.query("sources") || "").split(",").filter(Boolean);
  const kinds = (c.req.query("kinds") || "").split(",").filter(Boolean);

  const origin = new URL(c.req.url).origin;
  const [dotRes, wsdotRes, usaRes, natureRes, camsRes] = await Promise.allSettled([
    fetch(`${origin}/api/falcon-eye/dot-cams`).then((r) => r.json() as Promise<{ cams?: unknown[] }>),
    fetch(`${origin}/api/falcon-eye/wsdot-cams`).then((r) => r.json() as Promise<{ cams?: unknown[] }>),
    fetch(`${origin}/api/falcon-eye/usa-cams?all=1`).then((r) => r.json() as Promise<{ cams?: unknown[] }>),
    fetch(`${origin}/api/falcon-eye/nature-cams`).then((r) => r.json() as Promise<{ cams?: unknown[] }>),
    fetch(`${origin}/api/falcon-eye/cameras`).then((r) => r.json() as Promise<unknown[]>),
  ]);

  const all: { lat: number; lon: number; source: string; kind: string; [k: string]: unknown }[] = [];
  for (const res of [dotRes, wsdotRes, usaRes, natureRes]) {
    if (res.status === "fulfilled" && Array.isArray(res.value?.cams)) all.push(...(res.value.cams as typeof all));
  }
  if (camsRes.status === "fulfilled" && Array.isArray(camsRes.value)) all.push(...(camsRes.value as typeof all));

  const filtered = all.filter((cam) => {
    if (typeof cam.lat !== "number" || typeof cam.lon !== "number") return false;
    if (sources.length && !sources.includes(cam.source)) return false;
    if (kinds.length && !kinds.includes(cam.kind)) return false;
    return true;
  });

  const withDistance = filtered.map((cam) => ({ ...cam, distance: haversineKm(lat, lon, cam.lat, cam.lon) }));
  const nearby = withDistance.filter((cam) => cam.distance <= r).sort((a, b) => a.distance - b.distance).slice(0, limit);

  return c.json({ cams: nearby, total: filtered.length, center: { lat, lon }, radiusKm: r, ts: Date.now() });
});

// ── HLS playlist proxy ───────────────────────────────────────────────────
function corsHeaders(extra: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "Content-Type, Content-Length, X-Cache, X-Upstream-Status",
    ...extra,
  };
}

feCamsRoutes.get("/hls-proxy", async (c) => {
  if (c.req.query("healthz") === "1") {
    return new Response(JSON.stringify({ ok: true, service: "falcon-eye-hls-proxy", ts: Date.now() }),
      { status: 200, headers: { ...corsHeaders(), "Content-Type": "application/json" } });
  }
  const target = c.req.query("url");
  if (!target) return new Response(JSON.stringify({ error: "missing_url" }), { status: 400, headers: corsHeaders({ "Content-Type": "application/json" }) });
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { decoded = target; }
  if (!/^https?:\/\//i.test(decoded)) return new Response(JSON.stringify({ error: "invalid_url" }), { status: 400, headers: corsHeaders({ "Content-Type": "application/json" }) });

  const spoofReferer = c.req.query("referer");
  const spoofOrigin = c.req.query("origin");
  const upstreamHeaders: Record<string, string> = { "User-Agent": "Mozilla/5.0 (FalconEye HLS Proxy)", Accept: "*/*" };
  if (spoofReferer) upstreamHeaders["Referer"] = spoofReferer;
  if (spoofOrigin) upstreamHeaders["Origin"] = spoofOrigin;

  let upstream: Response;
  try {
    upstream = await fetch(decoded, { headers: upstreamHeaders, redirect: "follow", signal: AbortSignal.timeout(25000) });
  } catch (e) {
    return new Response(JSON.stringify({ error: "upstream_fetch_failed", message: (e as Error).message }), { status: 502, headers: corsHeaders({ "Content-Type": "application/json" }) });
  }
  const ct = upstream.headers.get("content-type") || "";
  const isPlaylist = ct.includes("mpegurl") || /\.m3u8(\?|$)/i.test(decoded);

  const proxyBase = "/api/falcon-eye/hls-proxy?url=";
  if (isPlaylist) {
    let text: string;
    try { text = await upstream.text(); } catch (e) { return new Response(`read error: ${(e as Error).message}`, { status: 502, headers: corsHeaders() }); }
    let base: URL | null = null;
    try { base = new URL(decoded); } catch {}
    const spoofQuery = (spoofReferer ? `&referer=${encodeURIComponent(spoofReferer)}` : "") + (spoofOrigin ? `&origin=${encodeURIComponent(spoofOrigin)}` : "");
    const rewrite = (u: string) => {
      if (!base) return u;
      try { return proxyBase + encodeURIComponent(new URL(u, base).toString()) + spoofQuery; } catch { return u; }
    };
    const rewritten = text.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${rewrite(u)}"`);
      return rewrite(trimmed);
    }).join("\n");
    const isMaster = /#EXT-X-STREAM-INF/.test(rewritten);
    return new Response(rewritten, {
      status: upstream.status,
      headers: corsHeaders({
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": isMaster ? "public, max-age=10" : "public, max-age=1",
        "X-Upstream-Status": String(upstream.status),
      }),
    });
  }
  const buf = await upstream.arrayBuffer();
  return new Response(buf, {
    status: upstream.status,
    headers: corsHeaders({ "Content-Type": ct || "video/mp2t", "Cache-Control": "public, max-age=2" }),
  });
});

// ── Cam snapshot proxy (image bytes with CORS) ───────────────────────────
const ONE_PX_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function offlinePng(): Response {
  return new Response(ONE_PX_PNG, {
    status: 200,
    headers: corsHeaders({ "Content-Type": "image/png", "Cache-Control": "public, max-age=30", "X-FalconEye-Offline": "1" }),
  });
}

feCamsRoutes.get("/cam-snap", async (c) => {
  const target = c.req.query("url");
  if (!target) return new Response("missing url", { status: 400, headers: corsHeaders() });
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { decoded = target; }
  if (!/^https?:\/\//i.test(decoded)) return new Response("invalid url", { status: 400, headers: corsHeaders() });
  const referer = c.req.query("referer");
  const ua = c.req.query("ua") || "Mozilla/5.0 (FalconEye CCTV Wall) AppleWebKit/537.36";
  const headers: Record<string, string> = { "User-Agent": ua, Accept: "image/*,*/*;q=0.8" };
  if (referer) headers["Referer"] = referer;

  const sep = decoded.includes("?") ? "&" : "?";
  const fetchUrl = `${decoded}${sep}_t=${Math.floor(Date.now() / 5000)}`;
  try {
    const upstream = await fetch(fetchUrl, { headers, redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return offlinePng();
    const ct = upstream.headers.get("content-type") || "";
    const buf = await upstream.arrayBuffer();
    if (!buf || buf.byteLength === 0) return offlinePng();
    return new Response(buf, {
      status: 200,
      headers: corsHeaders({ "Content-Type": ct || "image/jpeg", "Content-Length": String(buf.byteLength), "Cache-Control": "public, max-age=5, s-maxage=5" }),
    });
  } catch {
    return offlinePng();
  }
});

// ── Cam status probe ─────────────────────────────────────────────────────
function statusCors(extra: Record<string, string> = {}) {
  return { ...corsHeaders(extra), "Content-Type": "application/json" };
}
function djbKey(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  return "probe-" + (h >>> 0).toString(36) + "-" + url.length;
}

async function probeOne(env: Env, url: string): Promise<Record<string, unknown>> {
  const key = djbKey(url);
  const cached = await kvGetJSON<Record<string, unknown> & { checkedAt: number }>(env, "falcon-eye", key);
  if (cached && Date.now() - cached.checkedAt < 5 * 60 * 1000) {
    return { ...cached, url, cached: true };
  }
  const start = Date.now();
  let status = 0, alive = false;
  try {
    let r: Response | null = null;
    try {
      r = await fetch(url, { method: "HEAD", headers: { "User-Agent": "FalconEye/1.0 CamStatus" }, redirect: "follow", signal: AbortSignal.timeout(5000) });
    } catch { r = null; }
    if (!r || r.status === 405 || r.status === 403) {
      r = await fetch(url, { method: "GET", headers: { "User-Agent": "FalconEye/1.0 CamStatus", Range: "bytes=0-1023" }, redirect: "follow", signal: AbortSignal.timeout(5000) });
      try { await r.arrayBuffer(); } catch {}
    }
    status = r.status; alive = r.status >= 200 && r.status < 400;
  } catch {}
  const ms = Date.now() - start;
  const entry = { url, alive, status, ms, checkedAt: Date.now(), cached: false };
  await kvSetJSON(env, "falcon-eye", key, alive ? entry : { ...entry, checkedAt: Date.now() - 5 * 60 * 1000 / 2 });
  return entry;
}

feCamsRoutes.get("/cam-status", async (c) => {
  const single = c.req.query("url");
  const batch = c.req.query("urls");
  if (!single && !batch) return new Response(JSON.stringify({ error: "missing_params" }), { status: 400, headers: statusCors() });
  if (single) {
    let decoded: string; try { decoded = decodeURIComponent(single); } catch { decoded = single; }
    if (!/^https?:\/\//i.test(decoded)) return new Response(JSON.stringify({ error: "invalid_url" }), { status: 400, headers: statusCors() });
    const r = await probeOne(c.env, decoded);
    return new Response(JSON.stringify(r), { headers: statusCors() });
  }
  const urls = (batch as string).split("|").map((s) => { try { return decodeURIComponent(s); } catch { return s; } }).filter((s) => /^https?:\/\//i.test(s)).slice(0, 24);
  const results = await Promise.allSettled(urls.map((u) => probeOne(c.env, u)));
  const out = results.map((r, i) => r.status === "fulfilled" ? r.value : { url: urls[i], alive: false, status: 0, ms: 0, checkedAt: Date.now(), cached: false, error: String(r.reason) });
  const aliveCount = (out as { alive: boolean }[]).filter((r) => r.alive).length;
  return new Response(JSON.stringify({ results: out, total: out.length, alive: aliveCount }), { headers: statusCors() });
});
