import { getStore } from "@netlify/blobs";

// airplanes.live — free, no-key, community ADS-B network.
// Endpoints: https://api.airplanes.live/v2/{mil,ladd,pia,point/lat/lon/radius,hex/ICAO}
const CACHE_MS = 15_000;

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const store = getStore("darvis-falcon-eye");
  const url = new URL(req.url);
  const scope = (url.searchParams.get("scope") || "mil").toLowerCase();

  let endpoint;
  if (scope === "mil") endpoint = "https://api.airplanes.live/v2/mil";
  else if (scope === "ladd") endpoint = "https://api.airplanes.live/v2/ladd";
  else if (scope === "pia") endpoint = "https://api.airplanes.live/v2/pia";
  else if (scope === "point") {
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    const radius = url.searchParams.get("radius") || "250";
    if (!lat || !lon) return Response.json({ ac: [], error: "missing lat/lon" });
    endpoint = `https://api.airplanes.live/v2/point/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}/${encodeURIComponent(radius)}`;
  } else if (scope === "hex") {
    const hex = url.searchParams.get("hex");
    if (!hex) return Response.json({ ac: [], error: "missing hex" });
    endpoint = `https://api.airplanes.live/v2/hex/${encodeURIComponent(hex)}`;
  } else {
    return Response.json({ ac: [], error: `unknown scope: ${scope}` });
  }

  const cacheKey = `airplanes-live:${scope}:${url.search}`;
  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return Response.json({ ac: [], error: `airplanes.live ${res.status}` });
    const data = await res.json();
    const ac = (data.ac || [])
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
        gs: a.gs,              // ground speed in knots
        track: a.track,
        baroRate: a.baro_rate,
        squawk: a.squawk,
        mil: !!a.mil,
        category: a.category,
        emergency: a.emergency,
      }));

    const out = { ac, total: ac.length, source: "airplanes.live", scope, ts: Date.now() };
    try { await store.setJSON(cacheKey, { data: out, ts: Date.now() }); } catch {}
    return Response.json(out, { headers: { "X-Cache": "MISS" } });
  } catch (e) {
    return Response.json({ ac: [], error: String(e) });
  }
};

export const config = { path: "/api/falcon-eye/aircraft-live" };
