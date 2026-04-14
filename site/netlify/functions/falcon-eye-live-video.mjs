import { getStore } from "@netlify/blobs";

// Live Video discovery + validation agent.
//
// Maintains a validated list of public HLS (.m3u8) live streams —
// primarily 24/7 news channels from around the world, plus a few
// iconic public webcams — so the frontend's "Live" button always has
// something to show. Each candidate is probed on a schedule: we fetch
// the playlist, verify the `#EXTM3U` header, and (for master
// playlists) confirm it advertises at least one variant or segment
// stream. The result is written to `swarm:live-cams` with per-stream
// freshness, validity, and failure reason so the UI can filter to
// just the currently-working feeds.
//
// GET  /api/falcon-eye/live-video            → validated feeds
// GET  /api/falcon-eye/live-video?all=1      → including dead ones
// GET  /api/falcon-eye/live-video?refresh=1  → re-probe now and return
// POST /api/falcon-eye/live-video
//      { url, label, lat, lon, category, region, channelId }
//                                            → register a new candidate

const BLOB_KEY = "swarm:live-cams";
const CANDIDATES_KEY = "swarm:live-cams:candidates";
const REFRESH_MS = 10 * 60_000; // lazy refresh on GET if older than 10 min
const PROBE_TIMEOUT_MS = 6_000;
const MAX_PARALLEL = 12;

// ── Seed list ──────────────────────────────────────────────────────
// Curated known-public HLS streams. These are all feeds that have been
// publicly documented as free/embeddable. If any die the probe will
// mark them invalid — the blob never contains stale "live" claims.
const SEED = [
  // ── 24/7 news channels ────────────────────────────────────────
  { id: "aljazeera-en", label: "Al Jazeera English", category: "news", region: "Qatar",
    lat: 25.29, lon: 51.53,
    url: "https://live-hls-web-aje.getaj.net/AJE/01.m3u8" },
  { id: "aljazeera-ar", label: "Al Jazeera Arabic", category: "news", region: "Qatar",
    lat: 25.29, lon: 51.53,
    url: "https://live-hls-web-aja.getaj.net/AJA/01.m3u8" },
  { id: "dw-en", label: "Deutsche Welle English", category: "news", region: "Germany",
    lat: 50.94, lon: 6.96,
    url: "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8" },
  { id: "dw-de", label: "Deutsche Welle Deutsch", category: "news", region: "Germany",
    lat: 50.94, lon: 6.96,
    url: "https://dwamdstream101.akamaized.net/hls/live/2015524/dwstream101/index.m3u8" },
  { id: "france24-en", label: "France 24 English", category: "news", region: "France",
    lat: 48.85, lon: 2.35,
    url: "https://static.france24.com/live/F24_EN_LO_HLS/live_web.m3u8" },
  { id: "france24-fr", label: "France 24 Français", category: "news", region: "France",
    lat: 48.85, lon: 2.35,
    url: "https://static.france24.com/live/F24_FR_LO_HLS/live_web.m3u8" },
  { id: "france24-ar", label: "France 24 Arabic", category: "news", region: "France",
    lat: 48.85, lon: 2.35,
    url: "https://static.france24.com/live/F24_AR_LO_HLS/live_web.m3u8" },
  { id: "euronews-en", label: "Euronews English", category: "news", region: "France",
    lat: 45.76, lon: 4.83,
    url: "https://euronews-euronews-english-2-eu.xiaomi.wurl.tv/playlist.m3u8" },
  { id: "nasa-public", label: "NASA TV Public", category: "news", region: "USA",
    lat: 28.57, lon: -80.65,
    url: "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8" },
  { id: "nasa-media", label: "NASA TV Media", category: "news", region: "USA",
    lat: 28.57, lon: -80.65,
    url: "https://ntv2.akamaized.net/hls/live/2014076/NASA-NTV2-HLS/master.m3u8" },
  { id: "sky-news", label: "Sky News", category: "news", region: "UK",
    lat: 51.51, lon: -0.13,
    url: "https://skynews2-plutolive-vo.akamaized.net/cdnAkamaiLive_201/master.m3u8" },
  { id: "cbsn", label: "CBS News", category: "news", region: "USA",
    lat: 40.76, lon: -73.98,
    url: "https://cbsn-us.cbsnstream.cbsnews.com/out/v1/55a8648e8f134e82a470f83d562deeca/master.m3u8" },
  { id: "bloomberg-us", label: "Bloomberg TV US", category: "news", region: "USA",
    lat: 40.76, lon: -73.98,
    url: "https://liveprodtoamdsa.akamaized.net/PlayerHLS-BBNUS/live.m3u8" },
  { id: "nhk-world", label: "NHK World Japan", category: "news", region: "Japan",
    lat: 35.68, lon: 139.69,
    url: "https://nhkwlive-ojp.akamaized.net/hls/live/2003459/nhkwlive-ojp-en/index.m3u8" },
  { id: "abc-au", label: "ABC News Australia", category: "news", region: "Australia",
    lat: -33.87, lon: 151.21,
    url: "https://abc-iview-mediapackagestreams-2.akamaized.net/out/v1/6e1cc6d25ec0480ea099f6b1b8013350/index.m3u8" },
  { id: "trt-world", label: "TRT World", category: "news", region: "Turkey",
    lat: 41.01, lon: 28.98,
    url: "https://tv-trtworld.live.trt.com.tr/master.m3u8" },
  { id: "channel-news-asia", label: "Channel News Asia", category: "news", region: "Singapore",
    lat: 1.35, lon: 103.82,
    url: "https://d2e1asnsl7br7b.cloudfront.net/7782e205e72f43aeb4a48ec97f66ebbe/index.m3u8" },
  { id: "arirang", label: "Arirang TV", category: "news", region: "South Korea",
    lat: 37.57, lon: 126.98,
    url: "https://amdlive-ch01-ctnd-com.akamaized.net/arirang_1ch/smil:arirang_1ch.smil/playlist.m3u8" },

  // ── Iconic public live cams ───────────────────────────────────
  { id: "nasa-iss", label: "ISS Live Feed", category: "space", region: "Orbit",
    lat: 0, lon: 0,
    url: "https://iss-hls-ietf-01.ietfworks.com/iss.m3u8" },
];

// ── Probe ──────────────────────────────────────────────────────────
async function probeStream(candidate) {
  const started = Date.now();
  try {
    const r = await fetch(candidate.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (FalconEye-LiveVideo)",
        "Accept": "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "follow",
    });
    const latencyMs = Date.now() - started;
    if (!r.ok) {
      return { ...candidate, valid: false, status: r.status, reason: `http ${r.status}`, latencyMs, checkedAt: Date.now() };
    }
    const text = await r.text();
    if (!text || !text.startsWith("#EXTM3U")) {
      return { ...candidate, valid: false, status: r.status, reason: "no-extm3u", latencyMs, checkedAt: Date.now() };
    }
    const hasVariants = /#EXT-X-STREAM-INF/.test(text);
    const hasSegments = /#EXTINF/.test(text);
    if (!hasVariants && !hasSegments) {
      return { ...candidate, valid: false, status: r.status, reason: "empty-playlist", latencyMs, checkedAt: Date.now() };
    }
    const playlistKind = hasVariants ? "master" : "media";
    const segmentCount = hasSegments ? (text.match(/#EXTINF/g) || []).length : 0;
    const variantCount = hasVariants ? (text.match(/#EXT-X-STREAM-INF/g) || []).length : 0;
    return {
      ...candidate,
      valid: true,
      status: r.status,
      playlistKind,
      variantCount,
      segmentCount,
      contentType: r.headers.get("content-type") || null,
      latencyMs,
      checkedAt: Date.now(),
    };
  } catch (e) {
    return {
      ...candidate,
      valid: false,
      reason: String(e?.message || e).slice(0, 120),
      latencyMs: Date.now() - started,
      checkedAt: Date.now(),
    };
  }
}

async function probeAll(candidates) {
  const out = new Array(candidates.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= candidates.length) return;
      out[i] = await probeStream(candidates[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, candidates.length) }, worker));
  return out;
}

async function loadCandidates(store) {
  let extra = [];
  try {
    const d = await store.get(CANDIDATES_KEY, { type: "json" });
    if (Array.isArray(d)) extra = d;
  } catch {}
  // Dedupe by id — user-added candidates override seed entries with
  // the same id so an operator can fix a broken seed URL at runtime.
  const byId = new Map();
  for (const c of SEED) byId.set(c.id, c);
  for (const c of extra) if (c && c.id) byId.set(c.id, c);
  return [...byId.values()];
}

async function refresh(store) {
  const candidates = await loadCandidates(store);
  const probed = await probeAll(candidates);
  const valid = probed.filter((p) => p.valid).length;
  const snapshot = {
    streams: probed,
    total: probed.length,
    valid,
    invalid: probed.length - valid,
    ts: Date.now(),
  };
  try { await store.setJSON(BLOB_KEY, snapshot); } catch {}
  return snapshot;
}

async function loadOrRefresh(store, force = false) {
  if (!force) {
    try {
      const cached = await store.get(BLOB_KEY, { type: "json" });
      if (cached && Date.now() - (cached.ts || 0) < REFRESH_MS) return cached;
    } catch {}
  }
  return refresh(store);
}

export default async (req) => {
  const store = getStore("darvis-falcon-eye");
  const url = new URL(req.url);

  if (req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch {}
    if (!body.url || typeof body.url !== "string" || !/\.m3u8(\?|$)/i.test(body.url)) {
      return Response.json({ error: "POST body must include a valid .m3u8 url" }, { status: 400 });
    }
    const candidate = {
      id: body.id || body.channelId || `user-${Date.now()}`,
      label: body.label || body.url,
      url: body.url,
      category: body.category || "user",
      region: body.region || null,
      lat: typeof body.lat === "number" ? body.lat : null,
      lon: typeof body.lon === "number" ? body.lon : null,
      userAdded: true,
    };
    // Persist the candidate list so it survives cron refreshes.
    let extra = [];
    try {
      const d = await store.get(CANDIDATES_KEY, { type: "json" });
      if (Array.isArray(d)) extra = d;
    } catch {}
    extra = extra.filter((c) => c.id !== candidate.id);
    extra.push(candidate);
    try { await store.setJSON(CANDIDATES_KEY, extra); } catch {}
    const probed = await probeStream(candidate);
    return Response.json({ registered: true, probe: probed });
  }

  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const force = url.searchParams.get("refresh") === "1";
  const all = url.searchParams.get("all") === "1";
  const category = url.searchParams.get("category");

  const snap = await loadOrRefresh(store, force);
  let streams = snap.streams || [];
  if (!all) streams = streams.filter((s) => s.valid);
  if (category) streams = streams.filter((s) => s.category === category);

  return Response.json({
    streams,
    total: snap.total,
    valid: snap.valid,
    invalid: snap.invalid,
    ts: snap.ts,
    ageMs: Date.now() - (snap.ts || 0),
    filter: { all, category: category || null },
  });
};

export const config = { path: "/api/falcon-eye/live-video" };
