import { getStore } from "@netlify/blobs";

// Flight route resolver — "where is this flight actually going?"
//
// ADS-B state vectors give position/velocity/track but not the flight's
// planned origin and destination. adsbdb.com publishes a free
// community route database keyed by callsign that returns origin +
// destination ICAO/IATA codes, airport coordinates, airline metadata,
// and the aircraft registration/type. We cache per-callsign responses
// aggressively (routes almost never change within a day) so we can
// resolve hundreds of flights without hammering the upstream.
//
// GET /api/falcon-eye/flight-route?callsign=UAL123
// GET /api/falcon-eye/flight-route?callsign=UAL123,DAL22,RYR4G   (batch)

const ROUTE_TTL_MS = 6 * 60 * 60_000;  // 6h — routes are stable
const NEG_TTL_MS = 30 * 60_000;        // 30min — don't re-hammer unknowns
const BATCH_CAP = 40;

async function resolveOne(store, callsign) {
  const cs = callsign.trim().toUpperCase();
  if (!cs || cs.length < 3 || cs.length > 10) return { callsign: cs, found: false };

  const key = `route:${cs}`;
  try {
    const cached = await store.get(key, { type: "json" });
    if (cached && cached.ts) {
      const age = Date.now() - cached.ts;
      if (cached.found && age < ROUTE_TTL_MS) return cached.data;
      if (!cached.found && age < NEG_TTL_MS) return { callsign: cs, found: false };
    }
  } catch {}

  try {
    const r = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`, {
      headers: { "User-Agent": "FalconEye/1.0 (darvis1.netlify.app)" },
      signal: AbortSignal.timeout(6000),
    });
    if (r.status === 404) {
      try { await store.setJSON(key, { found: false, ts: Date.now() }); } catch {}
      return { callsign: cs, found: false };
    }
    if (!r.ok) return { callsign: cs, found: false, error: `adsbdb ${r.status}` };
    const body = await r.json();
    const fr = body?.response?.flightroute;
    if (!fr) {
      try { await store.setJSON(key, { found: false, ts: Date.now() }); } catch {}
      return { callsign: cs, found: false };
    }
    const data = {
      callsign: cs,
      found: true,
      airline: fr.airline?.name || null,
      airlineIata: fr.airline?.iata || null,
      airlineIcao: fr.airline?.icao || null,
      airlineCountry: fr.airline?.country || null,
      origin: fr.origin
        ? {
            iata: fr.origin.iata_code || null,
            icao: fr.origin.icao_code || null,
            name: fr.origin.name || null,
            city: fr.origin.municipality || null,
            country: fr.origin.country_name || null,
            lat: fr.origin.latitude ?? null,
            lon: fr.origin.longitude ?? null,
          }
        : null,
      destination: fr.destination
        ? {
            iata: fr.destination.iata_code || null,
            icao: fr.destination.icao_code || null,
            name: fr.destination.name || null,
            city: fr.destination.municipality || null,
            country: fr.destination.country_name || null,
            lat: fr.destination.latitude ?? null,
            lon: fr.destination.longitude ?? null,
          }
        : null,
    };
    try { await store.setJSON(key, { found: true, data, ts: Date.now() }); } catch {}
    return data;
  } catch (e) {
    return { callsign: cs, found: false, error: String(e?.message || e) };
  }
}

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const store = getStore("darvis-falcon-eye");
  const url = new URL(req.url);
  const cs = url.searchParams.get("callsign");
  if (!cs) return Response.json({ error: "missing callsign" }, { status: 400 });

  const list = cs.split(",").map((s) => s.trim()).filter(Boolean).slice(0, BATCH_CAP);

  if (list.length === 1) {
    const data = await resolveOne(store, list[0]);
    return Response.json(data);
  }

  const results = await Promise.allSettled(list.map((c) => resolveOne(store, c)));
  const out = {};
  list.forEach((c, i) => {
    const r = results[i];
    out[c.toUpperCase()] = r.status === "fulfilled" ? r.value : { callsign: c, found: false };
  });
  return Response.json({ routes: out, count: list.length, ts: Date.now() });
};

export const config = { path: "/api/falcon-eye/flight-route" };
