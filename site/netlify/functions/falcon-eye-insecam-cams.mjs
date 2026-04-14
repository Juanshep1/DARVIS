import { INSECAM } from "./_insecam-data.mjs";

// Insecam public-IP-camera source. ~2,400 unauthenticated IP cams indexed by
// insecam.org — mix of traffic, beaches, harbours, squares, marinas. ALL
// entries are http:// so every URL must be routed through the cam-snap proxy
// (browsers block mixed content on an HTTPS origin and we don't want the
// client IP hitting the camera directly).
//
// GET /api/falcon-eye/insecam-cams
//   ?lat=<f>&lon=<f>   center point
//   ?r=<km>            radius in km (default 200, max 20000)
//   ?limit=<n>         max cams returned (default 60, max 300)
//   ?category=<name>   filter to one category (traffic, beaches, ...)
//   ?kinds=<k1,k2>     filter to specific kinds (jpg,mjpeg,hls)
//
// Returns cams in the same shape as other falcon-eye cam endpoints:
//   { cams: [...], total, returned, ts, source:"insecam" }

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 300;
const DEFAULT_RADIUS_KM = 200;
const MAX_RADIUS_KM = 20000;

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Content-Type": "application/json",
    ...extra,
  };
}

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

// Always route through cam-snap so the browser never talks to the camera and
// mixed-content is avoided. cam-snap handles multipart/x-mixed-replace by
// extracting the first JPEG frame for MJPEG streams.
function proxyUrl(raw) {
  return "/api/falcon-eye/cam-snap?url=" + encodeURIComponent(raw);
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: cors() });
  }

  const u = new URL(req.url);
  const hasLat = u.searchParams.has("lat");
  const lat = parseFloat(u.searchParams.get("lat") || "0");
  const lon = parseFloat(u.searchParams.get("lon") || "0");
  const r = Math.min(parseFloat(u.searchParams.get("r") || DEFAULT_RADIUS_KM), MAX_RADIUS_KM);
  const limit = Math.min(parseInt(u.searchParams.get("limit") || DEFAULT_LIMIT, 10), MAX_LIMIT);
  const category = u.searchParams.get("category");
  const kindsParam = u.searchParams.get("kinds");
  const kindFilter = kindsParam ? new Set(kindsParam.split(",")) : null;

  let pool = INSECAM;
  if (category) pool = pool.filter((c) => c.t === category);
  if (kindFilter) pool = pool.filter((c) => kindFilter.has(c.k));

  let withDist;
  if (hasLat && !(lat === 0 && lon === 0)) {
    withDist = [];
    for (const c of pool) {
      const d = distanceKm(lat, lon, c.la, c.lo);
      if (d > r) continue;
      withDist.push({ ...c, d });
    }
    withDist.sort((a, b) => a.d - b.d);
  } else {
    // No center — just take a deterministic sample for the global view
    withDist = pool.slice(0, limit * 4).map((c) => ({ ...c, d: null }));
  }

  const top = withDist.slice(0, limit).map((c) => ({
    id: c.id,
    label: `${c.c || c.r || "Unknown"}${c.cc ? ", " + c.cc : ""}${c.t && c.t !== "other" ? " · " + c.t : ""}`,
    lat: c.la,
    lon: c.lo,
    kind: c.k === "hls" ? "hls" : c.k === "mjpeg" ? "mjpeg" : "jpg",
    url: proxyUrl(c.s),
    rawUrl: c.s,
    snapshotUrl: c.p || proxyUrl(c.s),
    source: "insecam",
    category: c.t,
    country: c.cc,
    distanceKm: c.d != null ? Math.round(c.d * 10) / 10 : undefined,
  }));

  return new Response(
    JSON.stringify({
      cams: top,
      total: withDist.length,
      returned: top.length,
      poolSize: INSECAM.length,
      source: "insecam",
      center: hasLat ? { lat, lon } : null,
      radiusKm: r,
      ts: Date.now(),
    }),
    { headers: cors({ "Cache-Control": "public, max-age=300" }) }
  );
};

export const config = { path: "/api/falcon-eye/insecam-cams" };
