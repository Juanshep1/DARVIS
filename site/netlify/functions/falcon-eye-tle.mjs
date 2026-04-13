import { getStore } from "@netlify/blobs";

const CACHE_MS = 6 * 60 * 60 * 1000; // 6h
const ALLOWED = new Set([
  "stations", "active", "weather", "noaa", "goes", "starlink",
  "gps-ops", "galileo", "glo-ops", "science", "geo", "military",
]);

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url);
  const group = (url.searchParams.get("group") || "stations").toLowerCase();
  if (!ALLOWED.has(group)) return Response.json({ error: "group not allowed" }, { status: 400 });

  const store = getStore("darvis-falcon-eye");
  const cacheKey = `tle:${group}`;

  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  const src = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return Response.json({ sats: [], error: `CelesTrak ${res.status}` }, { status: 200 });
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const sats = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
      sats.push({ name: lines[i].trim(), tle1: lines[i + 1], tle2: lines[i + 2] });
    }
    const out = { sats, group, ts: Date.now() };
    try { await store.setJSON(cacheKey, { data: out, ts: Date.now() }); } catch {}
    return Response.json(out, { headers: { "X-Cache": "MISS" } });
  } catch (e) {
    return Response.json({ sats: [], error: String(e) }, { status: 200 });
  }
};

export const config = { path: "/api/falcon-eye/tle" };
