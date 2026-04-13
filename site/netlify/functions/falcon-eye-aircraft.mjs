import { getStore } from "@netlify/blobs";

const CACHE_MS = 10_000;

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url);
  const bbox = url.searchParams.get("bbox"); // lamin,lomin,lamax,lomax
  const store = getStore("darvis-falcon-eye");
  const cacheKey = `aircraft:${bbox || "global"}`;

  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  let opensky = "https://opensky-network.org/api/states/all";
  if (bbox) {
    const [lamin, lomin, lamax, lomax] = bbox.split(",");
    opensky += `?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  }

  try {
    const res = await fetch(opensky, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return Response.json({ states: [], error: `OpenSky ${res.status}` }, { status: 200 });
    const data = await res.json();

    const planes = (data.states || []).slice(0, 1500).map((s) => ({
      icao: s[0],
      callsign: (s[1] || "").trim(),
      country: s[2],
      lon: s[5],
      lat: s[6],
      alt: s[7],
      vel: s[9],
      heading: s[10],
      vrate: s[11],
    })).filter((p) => p.lat != null && p.lon != null);

    const out = { states: planes, ts: Date.now() };
    try { await store.setJSON(cacheKey, { data: out, ts: Date.now() }); } catch {}
    return Response.json(out, { headers: { "X-Cache": "MISS" } });
  } catch (e) {
    return Response.json({ states: [], error: String(e) }, { status: 200 });
  }
};

export const config = { path: "/api/falcon-eye/aircraft" };
