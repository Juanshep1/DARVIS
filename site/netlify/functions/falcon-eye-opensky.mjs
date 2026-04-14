import { getStore } from "@netlify/blobs";

// OpenSky Network — global aircraft state vectors.
// Free public endpoint: https://opensky-network.org/api/states/all
// Optional basic auth via OPENSKY_USER / OPENSKY_PASS env for higher rate limits.
//
// GET /api/falcon-eye/opensky                 → full world (heavy, cached 30s)
// GET /api/falcon-eye/opensky?bbox=la,lo,La,Lo → bounding-box query
// GET /api/falcon-eye/opensky?icao24=abc123   → single aircraft

const CACHE_MS = 30_000;

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const store = getStore("darvis-falcon-eye");
  const url = new URL(req.url);
  const bbox = url.searchParams.get("bbox");
  const icao24 = url.searchParams.get("icao24");

  const params = new URLSearchParams();
  if (bbox) {
    const [lamin, lomin, lamax, lomax] = bbox.split(",").map((s) => s.trim());
    if (lamin && lomin && lamax && lomax) {
      params.set("lamin", lamin); params.set("lomin", lomin);
      params.set("lamax", lamax); params.set("lomax", lomax);
    }
  }
  if (icao24) params.set("icao24", icao24);

  const qs = params.toString();
  const endpoint = `https://opensky-network.org/api/states/all${qs ? "?" + qs : ""}`;
  const cacheKey = `opensky:${qs || "world"}`;

  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  const headers = { "User-Agent": "FalconEye/1.0 (darvis1.netlify.app)" };

  // OpenSky removed anonymous access in 2025. Prefer OAuth2 client
  // credentials (OPENSKY_CLIENT_ID/OPENSKY_CLIENT_SECRET); fall back
  // to legacy HTTP Basic for older accounts.
  const clientId = Netlify.env.get("OPENSKY_CLIENT_ID");
  const clientSecret = Netlify.env.get("OPENSKY_CLIENT_SECRET");
  const user = Netlify.env.get("OPENSKY_USER");
  const pass = Netlify.env.get("OPENSKY_PASS");

  async function getOAuthToken() {
    const tokenKey = "opensky:token";
    try {
      const cached = await store.get(tokenKey, { type: "json" });
      if (cached && cached.expires > Date.now() + 5000) return cached.token;
    } catch {}
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    const tr = await fetch("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!tr.ok) throw new Error(`opensky auth ${tr.status}`);
    const td = await tr.json();
    const token = td.access_token;
    const expires = Date.now() + (td.expires_in || 1800) * 1000;
    try { await store.setJSON(tokenKey, { token, expires }); } catch {}
    return token;
  }

  try {
    if (clientId && clientSecret) {
      const token = await getOAuthToken();
      headers.Authorization = `Bearer ${token}`;
    } else if (user && pass) {
      headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
    }
  } catch (e) {
    return Response.json({ ac: [], error: `opensky-auth: ${e.message || e}` });
  }

  try {
    const r = await fetch(endpoint, { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return Response.json({ ac: [], error: `opensky ${r.status}` });
    const data = await r.json();
    const states = Array.isArray(data.states) ? data.states : [];
    // Field order per OpenSky docs:
    // 0 icao24, 1 callsign, 2 origin_country, 3 time_position, 4 last_contact,
    // 5 longitude, 6 latitude, 7 baro_altitude, 8 on_ground, 9 velocity,
    // 10 true_track, 11 vertical_rate, 12 sensors, 13 geo_altitude,
    // 14 squawk, 15 spi, 16 position_source, 17 category
    const ac = states
      .filter((s) => s[5] != null && s[6] != null)
      .map((s) => ({
        hex: s[0],
        flight: (s[1] || "").trim(),
        country: s[2],
        lon: s[5],
        lat: s[6],
        altBaro: s[7],
        onGround: !!s[8],
        gs: s[9] != null ? s[9] * 1.94384 : null, // m/s → knots
        track: s[10],
        baroRate: s[11] != null ? s[11] * 196.85 : null, // m/s → ft/min
        altGeom: s[13],
        squawk: s[14],
        category: s[17],
      }));
    const out = { ac, total: ac.length, source: "opensky-network", ts: Date.now() };
    try { await store.setJSON(cacheKey, { data: out, ts: Date.now() }); } catch {}
    return Response.json(out, { headers: { "X-Cache": "MISS" } });
  } catch (e) {
    return Response.json({ ac: [], error: String(e) });
  }
};

export const config = { path: "/api/falcon-eye/opensky" };
