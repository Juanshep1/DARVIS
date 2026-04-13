import { getStore } from "@netlify/blobs";

// OpenSky anonymous API started blocking unauthenticated requests in 2024.
// Switched to airplanes.live — community ADS-B network, free, no key, no
// global endpoint so we fan out queries across 12 major aviation hubs and
// merge by ICAO hex. Covers all major flight corridors worldwide.
const CACHE_MS = 15_000;
const RADIUS_NM = 500;
const HUBS = [
  [40.64, -73.78],   // JFK — US Northeast
  [34.05, -118.24],  // LAX — US West
  [19.43, -99.13],   // Mexico City
  [-23.55, -46.63],  // São Paulo — South America
  [51.47, -0.46],    // LHR — UK / Europe West
  [48.86, 2.35],     // Paris — Europe central
  [55.75, 37.62],    // Moscow — Russia / Eastern Europe
  [30.04, 31.24],    // Cairo — North Africa / Middle East
  [25.25, 55.36],    // Dubai — Gulf
  [22.31, 113.92],   // Hong Kong — Greater China
  [35.55, 139.78],   // Tokyo — Japan
  [-33.94, 151.18],  // Sydney — Oceania
];

async function fetchHub([lat, lon]) {
  try {
    const r = await fetch(`https://api.airplanes.live/v2/point/${lat}/${lon}/${RADIUS_NM}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    return d.ac || [];
  } catch { return []; }
}

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url);
  const near = url.searchParams.get("near"); // "lat,lon"
  const store = getStore("darvis-falcon-eye");
  const cacheKey = near ? `aircraft:${near}` : "aircraft:global";

  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  let rawBatches = [];
  if (near) {
    const [lat, lon] = near.split(",").map(Number);
    if (!isNaN(lat) && !isNaN(lon)) rawBatches = [await fetchHub([lat, lon])];
  } else {
    rawBatches = await Promise.all(HUBS.map(fetchHub));
  }

  const byHex = new Map();
  for (const batch of rawBatches) for (const a of batch) if (a.hex) byHex.set(a.hex, a);

  const planes = Array.from(byHex.values())
    .filter((p) => p.lat != null && p.lon != null)
    .map((p) => ({
      icao: p.hex,
      callsign: (p.flight || "").trim(),
      country: "",
      lon: p.lon,
      lat: p.lat,
      alt: typeof p.alt_baro === "number" ? p.alt_baro * 0.3048 : 0, // ft to m
      vel: typeof p.gs === "number" ? p.gs * 0.514444 : 0,            // knots to m/s
      heading: p.track != null ? p.track : 0,
      vrate: p.baro_rate,
      type: p.t || "",
      reg: p.r || "",
      desc: p.desc || "",
    }));

  const out = { states: planes, ts: Date.now(), source: "airplanes.live", hubs: rawBatches.length };
  try { await store.setJSON(cacheKey, { data: out, ts: Date.now() }); } catch {}
  return Response.json(out, { headers: { "X-Cache": "MISS" } });
};

export const config = { path: "/api/falcon-eye/aircraft" };
