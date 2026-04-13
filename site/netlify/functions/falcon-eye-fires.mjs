import { getStore } from "@netlify/blobs";

const CACHE_MS = 30 * 60 * 1000; // 30 minutes

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const KEY = Netlify.env.get("FIRMS_MAP_KEY");
  if (!KEY) return Response.json({ fires: [], note: "no FIRMS_MAP_KEY configured" });

  const store = getStore("darvis-falcon-eye");
  try {
    const cached = await store.get("fires", { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  // VIIRS_SNPP_NRT, world, last 1 day
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEY}/VIIRS_SNPP_NRT/world/1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return Response.json({ fires: [], error: `firms ${res.status}` });
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return Response.json({ fires: [] });
    const headers = lines[0].split(",").map((h) => h.trim());
    const idx = (k) => headers.indexOf(k);
    const iLat = idx("latitude"), iLon = idx("longitude"), iConf = idx("confidence"),
          iFrp = idx("frp"), iDate = idx("acq_date"), iTime = idx("acq_time");

    const fires = [];
    // Cap at 4000 for browser perf
    const max = Math.min(lines.length - 1, 4000);
    for (let i = 1; i <= max; i++) {
      const f = lines[i].split(",");
      const lat = parseFloat(f[iLat]); const lon = parseFloat(f[iLon]);
      if (isNaN(lat) || isNaN(lon)) continue;
      fires.push({
        lat, lon,
        confidence: f[iConf],
        frp: parseFloat(f[iFrp]) || 0,
        date: f[iDate],
        time: f[iTime],
      });
    }
    const out = { fires, ts: Date.now() };
    try { await store.setJSON("fires", { data: out, ts: Date.now() }); } catch {}
    return Response.json(out, { headers: { "X-Cache": "MISS" } });
  } catch (e) {
    return Response.json({ fires: [], error: String(e) });
  }
};

export const config = { path: "/api/falcon-eye/fires" };
