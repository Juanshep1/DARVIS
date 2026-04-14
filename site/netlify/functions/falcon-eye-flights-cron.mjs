import { getStore } from "@netlify/blobs";

// Scheduled aircraft ingestor.
//
// Runs on a 2-minute cron and keeps a fresh global snapshot of every
// trackable aircraft — commercial + military — in a single Netlify
// blob (`flights:snapshot`). The frontend reader at
// /api/falcon-eye/flights serves from this snapshot instantly and only
// falls back to live upstream fetches if the snapshot is stale.
//
// Sources, in order of preference:
//   1. airplanes.live /v2/mil   — always on, no key, all military
//   2. ADS-B Exchange /v2/mil   — if RAPIDAPI_KEY is set (primary mil)
//   3. OpenSky /api/states/all  — if OPENSKY_CLIENT_ID/SECRET are set,
//                                 gives ~20k commercial flights globally
//
// Cron cadence is 2 minutes to respect OpenSky's OAuth2 credit budget
// (4000/day standard tier, 4 credits per global call → ~1000/day cap).
//
// NOTE: scheduled functions must NOT export a config.path — they are
// triggered by cron and cannot be called via HTTP.

const SNAPSHOT_KEY = "flights:snapshot";

function normalizeAirplanesLive(list, milHint) {
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
      mil: milHint || !!a.mil,
      category: a.category,
      emergency: a.emergency,
      source: "airplanes.live",
      seen: Math.floor(Date.now() / 1000),
    }));
}

function normalizeOpenSky(states) {
  return (states || [])
    .filter((s) => s[5] != null && s[6] != null)
    .map((s) => ({
      hex: s[0],
      flight: (s[1] || "").trim(),
      reg: "",
      type: "",
      desc: "",
      country: s[2],
      lat: s[6],
      lon: s[5],
      altBaro: s[7] != null ? Math.round(s[7] * 3.28084) : null,
      altGeom: s[13] != null ? Math.round(s[13] * 3.28084) : null,
      gs: s[9] != null ? Math.round(s[9] * 1.94384) : null,
      track: s[10],
      baroRate: s[11] != null ? Math.round(s[11] * 196.85) : null,
      squawk: s[14],
      onGround: !!s[8],
      mil: false,
      category: s[17],
      emergency: null,
      source: "opensky",
      seen: s[4] || Math.floor(Date.now() / 1000),
    }));
}

async function getOpenSkyToken(store) {
  const clientId = Netlify.env.get("OPENSKY_CLIENT_ID");
  const clientSecret = Netlify.env.get("OPENSKY_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  const tokenKey = "opensky:token";
  try {
    const cached = await store.get(tokenKey, { type: "json" });
    if (cached && cached.expires > Date.now() + 5000) return cached.token;
  } catch {}
  try {
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
    if (!tr.ok) return null;
    const td = await tr.json();
    const token = td.access_token;
    const expires = Date.now() + (td.expires_in || 1800) * 1000;
    try { await store.setJSON(tokenKey, { token, expires }); } catch {}
    return token;
  } catch { return null; }
}

async function fetchAirplanesLiveMil() {
  try {
    const r = await fetch("https://api.airplanes.live/v2/mil", {
      headers: { "User-Agent": "FalconEye/1.0 (darvis1.netlify.app)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { ac: [], error: `airplanes.live ${r.status}` };
    const data = await r.json();
    return { ac: normalizeAirplanesLive(data.ac, true), error: null };
  } catch (e) {
    return { ac: [], error: String(e?.message || e) };
  }
}

async function fetchAdsbxMil() {
  const key = Netlify.env.get("RAPIDAPI_KEY") || Netlify.env.get("ADSBX_API_KEY");
  if (!key) return { ac: [], error: "no-key", skipped: true };
  try {
    const r = await fetch("https://adsbexchange-com1.p.rapidapi.com/v2/mil/", {
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": "adsbexchange-com1.p.rapidapi.com",
        "User-Agent": "FalconEye/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { ac: [], error: `adsbx ${r.status}` };
    const data = await r.json();
    return { ac: normalizeAirplanesLive(data.ac, true).map((a) => ({ ...a, source: "adsbexchange" })), error: null };
  } catch (e) {
    return { ac: [], error: String(e?.message || e) };
  }
}

async function fetchOpenSkyGlobal(store) {
  const clientId = Netlify.env.get("OPENSKY_CLIENT_ID");
  const clientSecret = Netlify.env.get("OPENSKY_CLIENT_SECRET");
  if (!clientId || !clientSecret) return { ac: [], error: "no-creds", skipped: true };

  const token = await getOpenSkyToken(store);
  if (!token) return { ac: [], error: "token-fetch-failed" };

  try {
    const r = await fetch("https://opensky-network.org/api/states/all", {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "FalconEye/1.0 (darvis1.netlify.app)",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return { ac: [], error: `opensky ${r.status}` };
    const data = await r.json();
    return { ac: normalizeOpenSky(data.states), error: null };
  } catch (e) {
    return { ac: [], error: String(e?.message || e) };
  }
}

export default async () => {
  const store = getStore("darvis-falcon-eye");
  const started = Date.now();

  // Parallel fan-out across all three upstreams.
  const [alMil, adsbxMil, osAll] = await Promise.all([
    fetchAirplanesLiveMil(),
    fetchAdsbxMil(),
    fetchOpenSkyGlobal(store),
  ]);

  // Merge, dedup by hex. ADSBx and airplanes.live both report mil; if we
  // see the same tail in both, prefer ADSBx (more authoritative).
  const byHex = new Map();
  const ingest = (list, prefer) => {
    for (const a of list) {
      if (!a.hex) { byHex.set(`_${Math.random()}`, a); continue; }
      const prev = byHex.get(a.hex);
      if (!prev) { byHex.set(a.hex, a); continue; }
      const winner = prefer && a.source === prefer ? a : (prefer && prev.source === prefer ? prev : (a.source === "airplanes.live" ? a : prev));
      winner.mil = prev.mil || a.mil;
      // Prefer the record with richer metadata
      if (!winner.type && (a.type || prev.type)) winner.type = a.type || prev.type;
      if (!winner.desc && (a.desc || prev.desc)) winner.desc = a.desc || prev.desc;
      if (!winner.reg && (a.reg || prev.reg)) winner.reg = a.reg || prev.reg;
      byHex.set(a.hex, winner);
    }
  };
  ingest(osAll.ac, null);           // commercial baseline
  ingest(alMil.ac, "airplanes.live"); // mil overlay
  ingest(adsbxMil.ac, "adsbexchange"); // preferred mil

  const ac = [...byHex.values()];
  const mil = ac.filter((a) => a.mil).length;

  const snapshot = {
    ac,
    total: ac.length,
    commercial: ac.length - mil,
    military: mil,
    sources: {
      "airplanes.live": { count: alMil.ac.length, error: alMil.error, skipped: !!alMil.skipped },
      adsbexchange:     { count: adsbxMil.ac.length, error: adsbxMil.error, skipped: !!adsbxMil.skipped },
      opensky:          { count: osAll.ac.length, error: osAll.error, skipped: !!osAll.skipped },
    },
    ts: Date.now(),
    durationMs: Date.now() - started,
  };

  try { await store.setJSON(SNAPSHOT_KEY, snapshot); } catch (e) {
    console.error("snapshot write failed:", e?.message || e);
  }

  return new Response(JSON.stringify({
    ok: true,
    total: snapshot.total,
    commercial: snapshot.commercial,
    military: snapshot.military,
    sources: snapshot.sources,
    durationMs: snapshot.durationMs,
  }), { headers: { "Content-Type": "application/json" } });
};

// Every 2 minutes — respects OpenSky's OAuth2 credit budget
// (4000/day standard ÷ 4 credits/call = 1000 calls/day max).
export const config = {
  schedule: "*/2 * * * *",
};
