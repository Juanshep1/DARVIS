import { Hono } from "hono";
import type { Env } from "../../env";
import { kvGetJSON, kvSetJSON } from "../../lib/kv";

export const feFlightsRoutes = new Hono<{ Bindings: Env }>();

// ── airplanes.live fan-out for global commercial + mil aircraft ──────────
const HUBS: [number, number][] = [
  [40.64, -73.78], [34.05, -118.24], [19.43, -99.13], [-23.55, -46.63],
  [51.47, -0.46], [48.86, 2.35], [55.75, 37.62], [30.04, 31.24],
  [25.25, 55.36], [22.31, 113.92], [35.55, 139.78], [-33.94, 151.18],
];

async function fetchHub([lat, lon]: [number, number]): Promise<Record<string, unknown>[]> {
  try {
    const r = await fetch(`https://api.airplanes.live/v2/point/${lat}/${lon}/500`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const d = (await r.json()) as { ac?: Record<string, unknown>[] };
    return d.ac || [];
  } catch {
    return [];
  }
}

function normalizeAc(list: Record<string, unknown>[], milHint = false): Record<string, unknown>[] {
  return (list || []).filter((a) => a.lat != null && a.lon != null).map((a) => ({
    hex: a.hex,
    flight: (String(a.flight || "")).trim(),
    reg: a.r || "",
    type: a.t || "",
    desc: a.desc || "",
    lat: a.lat, lon: a.lon,
    altBaro: a.alt_baro, altGeom: a.alt_geom,
    gs: a.gs, track: a.track,
    squawk: a.squawk,
    mil: milHint || /^(REACH|SAM|RCH|UAL)?/i.test(String(a.flight || "")),
  }));
}

// ── /aircraft (fanned-out commercial + mil) ──────────────────────────────
feFlightsRoutes.get("/aircraft", async (c) => {
  const cached = await kvGetJSON<{ data: unknown; ts: number }>(c.env, "falcon-eye", "aircraft");
  if (cached && Date.now() - cached.ts < 15_000) return c.json(cached.data);
  const results = await Promise.allSettled(HUBS.map(fetchHub));
  const merged = new Map<string, Record<string, unknown>>();
  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const ac of normalizeAc(r.value)) {
        const hex = ac.hex as string | undefined;
        if (hex && !merged.has(hex)) merged.set(hex, ac);
      }
    }
  }
  const out = { aircraft: Array.from(merged.values()), ts: Date.now() };
  await kvSetJSON(c.env, "falcon-eye", "aircraft", { data: out, ts: Date.now() });
  return c.json(out);
});

// ── /aircraft-live (direct airplanes.live proxy) ─────────────────────────
feFlightsRoutes.get("/aircraft-live", async (c) => {
  const scope = (c.req.query("scope") || "mil").toLowerCase();
  let endpoint: string;
  if (scope === "mil") endpoint = "https://api.airplanes.live/v2/mil";
  else if (scope === "ladd") endpoint = "https://api.airplanes.live/v2/ladd";
  else if (scope === "pia") endpoint = "https://api.airplanes.live/v2/pia";
  else if (scope === "point") {
    const lat = c.req.query("lat"), lon = c.req.query("lon"), radius = c.req.query("radius") || "250";
    if (!lat || !lon) return c.json({ ac: [], error: "missing lat/lon" });
    endpoint = `https://api.airplanes.live/v2/point/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}/${encodeURIComponent(radius)}`;
  } else if (scope === "hex") {
    const hex = c.req.query("hex");
    if (!hex) return c.json({ ac: [], error: "missing hex" });
    endpoint = `https://api.airplanes.live/v2/hex/${encodeURIComponent(hex)}`;
  } else {
    return c.json({ ac: [], error: `unknown scope: ${scope}` });
  }
  try {
    const r = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return c.json({ ac: [], error: `airplanes.live ${r.status}` });
    const d = (await r.json()) as { ac?: Record<string, unknown>[] };
    return c.json({ ac: normalizeAc(d.ac || [], scope === "mil"), scope, ts: Date.now() });
  } catch (e) {
    return c.json({ ac: [], error: (e as Error).message });
  }
});

// ── /opensky proxy (same shape as Netlify version) ───────────────────────
feFlightsRoutes.get("/opensky", async (c) => {
  const bbox = c.req.query("bbox");
  const icao24 = c.req.query("icao24");
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
  try {
    const r = await fetch(`https://opensky-network.org/api/states/all${qs ? "?" + qs : ""}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return c.json({ states: [], error: `opensky ${r.status}` });
    return c.json(await r.json());
  } catch (e) {
    return c.json({ states: [], error: (e as Error).message });
  }
});

// ── /adsbx — stub (requires RAPIDAPI_KEY) ────────────────────────────────
feFlightsRoutes.get("/adsbx", async (c) => {
  const RAPIDAPI_KEY = (c.env as unknown as { RAPIDAPI_KEY?: string }).RAPIDAPI_KEY;
  const scope = (c.req.query("scope") || "mil").toLowerCase();
  if (!RAPIDAPI_KEY) {
    // fall back to airplanes.live — same shape
    const forward = await fetch(`${new URL(c.req.url).origin}/api/falcon-eye/aircraft-live?scope=${encodeURIComponent(scope)}`);
    return new Response(await forward.text(), { status: forward.status, headers: { "Content-Type": "application/json" } });
  }
  let path: string;
  if (scope === "mil") path = "/v2/mil";
  else if (scope === "point") {
    const lat = c.req.query("lat"), lon = c.req.query("lon"), radius = c.req.query("radius") || "250";
    if (!lat || !lon) return c.json({ ac: [], error: "missing lat/lon" });
    path = `/v2/point/${lat}/${lon}/${radius}`;
  } else if (scope === "hex") {
    const hex = c.req.query("hex");
    if (!hex) return c.json({ ac: [], error: "missing hex" });
    path = `/v2/hex/${hex}`;
  } else {
    return c.json({ ac: [], error: `unknown scope: ${scope}` });
  }
  try {
    const r = await fetch(`https://adsbexchange-com1.p.rapidapi.com${path}`, {
      headers: { "X-RapidAPI-Key": RAPIDAPI_KEY, "X-RapidAPI-Host": "adsbexchange-com1.p.rapidapi.com" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return c.json({ ac: [], error: `adsbx ${r.status}` });
    const d = (await r.json()) as { ac?: Record<string, unknown>[] };
    return c.json({ ac: normalizeAc(d.ac || [], scope === "mil"), scope, ts: Date.now() });
  } catch (e) {
    return c.json({ ac: [], error: (e as Error).message });
  }
});

// ── /flight-route — adsbdb.com route resolver (cached per callsign) ──────
async function resolveRoute(env: Env, callsign: string): Promise<Record<string, unknown>> {
  const cs = callsign.trim().toUpperCase();
  if (!cs || cs.length < 3 || cs.length > 10) return { callsign: cs, found: false };
  const key = `route:${cs}`;
  const cached = await kvGetJSON<{ data?: Record<string, unknown>; found?: boolean; ts: number }>(env, "falcon-eye", key);
  if (cached?.ts) {
    const age = Date.now() - cached.ts;
    if (cached.found && age < 6 * 60 * 60_000 && cached.data) return cached.data;
    if (!cached.found && age < 30 * 60_000) return { callsign: cs, found: false };
  }
  try {
    const r = await fetch(`https://api.adsbdb.com/v0/callsign/${cs}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`adsbdb ${r.status}`);
    const d = (await r.json()) as { response?: { flightroute?: Record<string, unknown> } };
    const route = d.response?.flightroute;
    if (!route) {
      await kvSetJSON(env, "falcon-eye", key, { found: false, ts: Date.now() });
      return { callsign: cs, found: false };
    }
    const out = { callsign: cs, found: true, ...route };
    await kvSetJSON(env, "falcon-eye", key, { data: out, found: true, ts: Date.now() });
    return out;
  } catch {
    return { callsign: cs, found: false };
  }
}

feFlightsRoutes.get("/flight-route", async (c) => {
  const callsign = c.req.query("callsign");
  if (!callsign) return c.json({ error: "missing callsign" }, 400);
  const list = callsign.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40);
  if (list.length === 1) return c.json(await resolveRoute(c.env, list[0]));
  const results = await Promise.all(list.map((cs) => resolveRoute(c.env, cs)));
  return c.json({ routes: results });
});

// ── /flights — unified commercial+mil feed ───────────────────────────────
feFlightsRoutes.get("/flights", async (c) => {
  const bbox = c.req.query("bbox");
  const includeMil = c.req.query("mil") !== "0";
  const includeCommercial = c.req.query("commercial") !== "0" && !!bbox;

  const [milRes, commRes] = await Promise.allSettled([
    includeMil ? fetch("https://api.airplanes.live/v2/mil", { signal: AbortSignal.timeout(10000) }).then((r) => r.json() as Promise<{ ac?: Record<string, unknown>[] }>) : Promise.resolve({ ac: [] }),
    includeCommercial && bbox
      ? fetch(`https://opensky-network.org/api/states/all?${(() => {
          const [lamin, lomin, lamax, lomax] = bbox.split(",").map((s) => s.trim());
          return new URLSearchParams({ lamin, lomin, lamax, lomax }).toString();
        })()}`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json() as Promise<{ states?: unknown[][] }>)
      : Promise.resolve({ states: [] }),
  ]);

  const mil = milRes.status === "fulfilled" ? normalizeAc((milRes.value as { ac?: Record<string, unknown>[] }).ac || [], true) : [];
  let comm: Record<string, unknown>[] = [];
  if (commRes.status === "fulfilled") {
    const states = (commRes.value as { states?: unknown[][] }).states || [];
    comm = states.filter((s): s is unknown[] => Array.isArray(s) && (s[5] != null) && (s[6] != null)).map((s) => ({
      hex: s[0],
      flight: String(s[1] || "").trim(),
      reg: "",
      type: "",
      desc: "",
      lat: s[6] as number,
      lon: s[5] as number,
      altBaro: s[7],
      altGeom: s[13],
      gs: s[9],
      track: s[10],
      squawk: s[14],
      mil: false,
    }));
  }

  const merged = new Map<string, Record<string, unknown>>();
  for (const a of [...mil, ...comm]) {
    const hex = a.hex as string | undefined;
    if (hex && !merged.has(hex)) merged.set(hex, a);
  }
  return c.json({ flights: Array.from(merged.values()), ts: Date.now() });
});
