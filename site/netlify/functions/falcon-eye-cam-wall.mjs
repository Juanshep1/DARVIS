import { getStore } from "@netlify/blobs";

// Camera wall bundler. Merges all camera sources, sorts by distance from a
// requested point, and returns the top N as a ready-to-render bundle for the
// CCTV wall page. Pulls from the already-cached individual sources so this
// function stays fast (<1s warm).
//
// GET /api/falcon-eye/cam-wall
//   ?lat=<f>&lon=<f>          center point (default: continental US)
//   ?r=<km>                   radius in km (default 50, max 2000)
//   ?limit=<n>                max cams returned (default 16, max 64)
//   ?sources=<s1,s2>          filter to specific sources (caltrans,wsdot,...)
//   ?kinds=<k1,k2>            filter to specific kinds (hls,jpg,iframe,mp4)
//
// Response: { cams: [...], total, center, radiusKm, ts }

const CACHE_MS = 90 * 1000;
const DEFAULT_LIMIT = 16;
const MAX_LIMIT = 64;
const DEFAULT_RADIUS_KM = 50;
const MAX_RADIUS_KM = 2000;

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Content-Type": "application/json",
    ...extra,
  };
}

// Haversine distance in km. Good enough for the radius filter.
function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchSource(origin, path, tag) {
  try {
    const r = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return [];
    const d = await r.json();
    const arr = d.cams || d.webcams || (Array.isArray(d) ? d : []);
    return arr.map((c) => ({ ...c, source: c.source || tag }));
  } catch { return []; }
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: cors() });
  }

  const u = new URL(req.url);
  const lat = parseFloat(u.searchParams.get("lat") || "39.5");
  const lon = parseFloat(u.searchParams.get("lon") || "-98.35");
  const r = Math.min(parseFloat(u.searchParams.get("r") || DEFAULT_RADIUS_KM), MAX_RADIUS_KM);
  const limit = Math.min(parseInt(u.searchParams.get("limit") || DEFAULT_LIMIT, 10), MAX_LIMIT);
  const sourcesParam = u.searchParams.get("sources");
  const kindsParam = u.searchParams.get("kinds");
  const sourceFilter = sourcesParam ? new Set(sourcesParam.split(",")) : null;
  const kindFilter = kindsParam ? new Set(kindsParam.split(",")) : null;

  // Cache key — round to 0.5° grid so nearby calls share a cache entry
  const gridLat = Math.round(lat * 2) / 2;
  const gridLon = Math.round(lon * 2) / 2;
  const cacheKey = `wall-${gridLat}-${gridLon}-${r}-${limit}-${sourcesParam || "all"}-${kindsParam || "all"}`;

  const store = getStore("darvis-falcon-eye");
  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return new Response(JSON.stringify(cached.data), { headers: cors({ "X-Cache": "HIT" }) });
    }
  } catch {}

  // Same-origin fetch — Netlify sets this in the request URL
  const origin = new URL(req.url).origin;

  const jobs = [
    fetchSource(origin, "/api/falcon-eye/dot-cams", "caltrans"),
    fetchSource(origin, "/api/falcon-eye/wsdot-cams", "wsdot"),
    fetchSource(origin, "/api/falcon-eye/nature-cams", "nature"),
    fetchSource(origin, `/api/falcon-eye/webcams?near=${lat.toFixed(3)},${lon.toFixed(3)}`, "windy"),
  ];

  const results = await Promise.allSettled(jobs);
  const all = [];
  for (const res of results) if (res.status === "fulfilled") all.push(...res.value);

  // Normalize + compute distance
  const normalized = [];
  for (const c of all) {
    const cLat = c.lat;
    const cLon = c.lon ?? c.lng;
    if (cLat == null || cLon == null) continue;
    if (sourceFilter && !sourceFilter.has(c.source)) continue;
    if (kindFilter && !kindFilter.has(c.kind || "iframe")) continue;
    const dist = distanceKm(lat, lon, cLat, cLon);
    if (dist > r) continue;
    normalized.push({
      id: c.id,
      label: c.label || c.title || "Camera",
      lat: cLat,
      lon: cLon,
      kind: c.kind || "iframe",
      url: c.url,
      snapshotUrl: c.snapshotUrl || null,
      thumb: c.thumb || null,
      source: c.source || "",
      distanceKm: Math.round(dist * 10) / 10,
    });
  }

  normalized.sort((a, b) => a.distanceKm - b.distanceKm);
  const top = normalized.slice(0, limit);

  // Build a breakdown-by-source for the wall UI
  const bySource = {};
  for (const c of top) bySource[c.source] = (bySource[c.source] || 0) + 1;

  const payload = {
    cams: top,
    total: normalized.length,
    returned: top.length,
    bySource,
    center: { lat, lon },
    radiusKm: r,
    ts: Date.now(),
  };

  try { await store.setJSON(cacheKey, { data: payload, ts: Date.now() }); } catch {}
  return new Response(JSON.stringify(payload), { headers: cors({ "X-Cache": "MISS" }) });
};

export const config = { path: "/api/falcon-eye/cam-wall" };
