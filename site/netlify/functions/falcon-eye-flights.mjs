import { getStore } from "@netlify/blobs";

// Unified flights feed — commercial + military in one shape.
//
// Merges:
//  - Commercial traffic from OpenSky Network state vectors
//    (supports OAuth2 client credentials; falls back to anonymous
//    which only succeeds if the environment has legacy access).
//  - Military traffic from airplanes.live /v2/mil (always-on, no key).
//
// The frontend gets one endpoint for "all aircraft in this viewport"
// with a consistent schema — flight, type, lat, lon, altitude, ground
// speed, track, squawk, emergency flag, and a `mil` boolean. The
// `track` and `gs` fields let the renderer dead-reckon between polls
// so markers keep moving smoothly even when cached.
//
// GET /api/falcon-eye/flights                       → mil only (fast)
// GET /api/falcon-eye/flights?bbox=la,lo,La,Lo      → commercial+mil in bbox
// GET /api/falcon-eye/flights?bbox=...&commercial=0 → mil only in bbox
// GET /api/falcon-eye/flights?bbox=...&mil=0        → commercial only

const CACHE_MS = 12_000;

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
    }));
}

function normalizeOpenSky(states) {
  return (states || [])
    .filter((s) => s[5] != null && s[6] != null && !s[8]) // drop on-ground
    .map((s) => ({
      hex: s[0],
      flight: (s[1] || "").trim(),
      reg: "",
      type: "",
      desc: "",
      country: s[2],
      lat: s[6],
      lon: s[5],
      altBaro: s[7] != null ? Math.round(s[7] * 3.28084) : null,  // m → ft
      altGeom: s[13] != null ? Math.round(s[13] * 3.28084) : null,
      gs: s[9] != null ? Math.round(s[9] * 1.94384) : null,       // m/s → kts
      track: s[10],
      baroRate: s[11] != null ? Math.round(s[11] * 196.85) : null, // m/s → ft/min
      squawk: s[14],
      mil: false,
      category: s[17],
      emergency: null,
      source: "opensky",
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
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
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

async function fetchOpenSky(store, bbox) {
  const params = new URLSearchParams();
  if (bbox) {
    params.set("lamin", bbox.lamin);
    params.set("lomin", bbox.lomin);
    params.set("lamax", bbox.lamax);
    params.set("lomax", bbox.lomax);
  }
  const qs = params.toString();
  const endpoint = `https://opensky-network.org/api/states/all${qs ? "?" + qs : ""}`;
  const headers = { "User-Agent": "FalconEye/1.0 (darvis1.netlify.app)" };
  const user = Netlify.env.get("OPENSKY_USER");
  const pass = Netlify.env.get("OPENSKY_PASS");
  const token = await getOpenSkyToken(store);
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (user && pass) headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

  try {
    const r = await fetch(endpoint, { headers, signal: AbortSignal.timeout(14000) });
    if (!r.ok) return { ac: [], error: `opensky ${r.status}` };
    const data = await r.json();
    return { ac: normalizeOpenSky(data.states), error: null };
  } catch (e) {
    return { ac: [], error: String(e?.message || e) };
  }
}

async function fetchMil(bbox) {
  // airplanes.live: /v2/mil is global and fast. If we have a bbox we
  // can also pull a /v2/point/.../radius for the viewport centre,
  // but the global mil feed is small enough (<500 aircraft) that the
  // simplest thing is to fetch all and filter client-side in the bbox.
  try {
    const r = await fetch("https://api.airplanes.live/v2/mil", {
      headers: { "User-Agent": "FalconEye/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return { ac: [], error: `airplanes.live ${r.status}` };
    const data = await r.json();
    let ac = normalizeAirplanesLive(data.ac, true);
    if (bbox) {
      ac = ac.filter((a) =>
        a.lat >= bbox.lamin && a.lat <= bbox.lamax &&
        a.lon >= bbox.lomin && a.lon <= bbox.lomax
      );
    }
    return { ac, error: null };
  } catch (e) {
    return { ac: [], error: String(e?.message || e) };
  }
}

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const store = getStore("darvis-falcon-eye");
  const url = new URL(req.url);

  const bboxRaw = url.searchParams.get("bbox");
  const wantCommercial = url.searchParams.get("commercial") !== "0";
  const wantMil = url.searchParams.get("mil") !== "0";

  let bbox = null;
  if (bboxRaw) {
    const parts = bboxRaw.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      bbox = { lamin: parts[0], lomin: parts[1], lamax: parts[2], lomax: parts[3] };
    }
  }

  const cacheKey = `flights:${bboxRaw || "global"}:${wantCommercial ? 1 : 0}:${wantMil ? 1 : 0}`;
  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  // Run both sources in parallel. Without a bbox, OpenSky global is too
  // heavy (20k+ aircraft, 5MB response) so we skip it unless bbox is set.
  const tasks = [];
  if (wantCommercial && bbox) tasks.push(fetchOpenSky(store, bbox).then((r) => ({ kind: "commercial", ...r })));
  if (wantMil) tasks.push(fetchMil(bbox).then((r) => ({ kind: "mil", ...r })));

  const results = await Promise.all(tasks);
  const merged = [];
  const sources = {};
  for (const r of results) {
    sources[r.kind] = { count: r.ac.length, error: r.error };
    merged.push(...r.ac);
  }

  // Dedup by hex — if the same aircraft shows up in both OpenSky and
  // airplanes.live mil feed, prefer the richer airplanes.live record
  // (it has desc/type/reg/emergency) but mark mil from either source.
  const byHex = new Map();
  for (const a of merged) {
    if (!a.hex) { byHex.set(`_${Math.random()}`, a); continue; }
    const prev = byHex.get(a.hex);
    if (!prev) byHex.set(a.hex, a);
    else {
      const winner = a.source === "airplanes.live" ? a : prev;
      winner.mil = prev.mil || a.mil;
      byHex.set(a.hex, winner);
    }
  }
  const deduped = [...byHex.values()];

  const out = {
    ac: deduped,
    total: deduped.length,
    commercial: deduped.filter((a) => !a.mil).length,
    military: deduped.filter((a) => a.mil).length,
    sources,
    bbox: bbox ? [bbox.lamin, bbox.lomin, bbox.lamax, bbox.lomax] : null,
    ts: Date.now(),
  };
  try { await store.setJSON(cacheKey, { data: out, ts: Date.now() }); } catch {}
  return Response.json(out, { headers: { "X-Cache": "MISS" } });
};

export const config = { path: "/api/falcon-eye/flights" };
