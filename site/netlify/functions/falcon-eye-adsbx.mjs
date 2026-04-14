import { getStore } from "@netlify/blobs";

// ADS-B Exchange — unfiltered aircraft data, including military.
// Public ADSBx data is served via the adsbexchange-com1 endpoint on RapidAPI.
// Requires a RAPIDAPI_KEY env var (free tier available on RapidAPI marketplace).
// If the key is missing we transparently fall back to airplanes.live (our
// existing free mil feed) so the endpoint still returns data.
//
// GET /api/falcon-eye/adsbx?scope=mil
// GET /api/falcon-eye/adsbx?scope=point&lat=..&lon=..&radius=250
// GET /api/falcon-eye/adsbx?scope=hex&hex=abc123

const CACHE_MS = 15_000;
const RAPIDAPI_HOST = "adsbexchange-com1.p.rapidapi.com";

function normalize(list) {
  return (list || [])
    .filter((a) => a.lat != null && a.lon != null)
    .map((a) => ({
      hex: a.hex,
      flight: (a.flight || "").trim(),
      reg: a.r || "",
      type: a.t || "",
      desc: a.desc || "",
      lat: a.lat,
      lon: a.lon,
      altBaro: a.alt_baro,
      altGeom: a.alt_geom,
      gs: a.gs,
      track: a.track,
      baroRate: a.baro_rate,
      squawk: a.squawk,
      mil: !!a.mil,
      category: a.category,
      emergency: a.emergency,
    }));
}

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const store = getStore("darvis-falcon-eye");
  const url = new URL(req.url);
  const scope = (url.searchParams.get("scope") || "mil").toLowerCase();

  const RAPIDAPI_KEY = Netlify.env.get("RAPIDAPI_KEY") || Netlify.env.get("ADSBX_API_KEY");

  // Build primary (ADSBx RapidAPI) and fallback (airplanes.live) URLs.
  let primary = null, fallback = null;
  if (scope === "mil") {
    primary = RAPIDAPI_KEY ? `https://${RAPIDAPI_HOST}/v2/mil/` : null;
    fallback = "https://api.airplanes.live/v2/mil";
  } else if (scope === "point") {
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    const radius = url.searchParams.get("radius") || "250";
    if (!lat || !lon) return Response.json({ ac: [], error: "missing lat/lon" });
    primary = RAPIDAPI_KEY
      ? `https://${RAPIDAPI_HOST}/v2/lat/${lat}/lon/${lon}/dist/${radius}/`
      : null;
    fallback = `https://api.airplanes.live/v2/point/${lat}/${lon}/${radius}`;
  } else if (scope === "hex") {
    const hex = url.searchParams.get("hex");
    if (!hex) return Response.json({ ac: [], error: "missing hex" });
    primary = RAPIDAPI_KEY ? `https://${RAPIDAPI_HOST}/v2/hex/${hex}/` : null;
    fallback = `https://api.airplanes.live/v2/hex/${hex}`;
  } else {
    return Response.json({ ac: [], error: `unknown scope: ${scope}` });
  }

  const cacheKey = `adsbx:${scope}:${url.search}`;
  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  async function hit(endpoint, rapid) {
    const headers = { "User-Agent": "FalconEye/1.0" };
    if (rapid) {
      headers["X-RapidAPI-Key"] = RAPIDAPI_KEY;
      headers["X-RapidAPI-Host"] = RAPIDAPI_HOST;
    }
    const r = await fetch(endpoint, { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${endpoint} ${r.status}`);
    return r.json();
  }

  try {
    let data = null, sourceLabel = null;
    if (primary) {
      try { data = await hit(primary, true); sourceLabel = "adsbexchange"; }
      catch { data = null; }
    }
    if (!data && fallback) {
      data = await hit(fallback, false);
      sourceLabel = "airplanes.live (fallback)";
    }
    const ac = normalize(data?.ac);
    const out = { ac, total: ac.length, source: sourceLabel, scope, ts: Date.now() };
    try { await store.setJSON(cacheKey, { data: out, ts: Date.now() }); } catch {}
    return Response.json(out, { headers: { "X-Cache": "MISS" } });
  } catch (e) {
    return Response.json({ ac: [], error: String(e) });
  }
};

export const config = { path: "/api/falcon-eye/adsbx" };
