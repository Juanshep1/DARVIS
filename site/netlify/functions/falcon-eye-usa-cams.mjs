import { getStore } from "@netlify/blobs";

// OpenTrafficCamMap — AidanWelch/OpenTrafficCamMap on GitHub.
// Pre-aggregated nationwide US DOT traffic cameras, every entry is an
// HLS .m3u8 live stream. ~7000 cams across all 50 states. Free, public,
// no key. We proxy + cache the GitHub raw JSON.
const CACHE_MS = 60 * 60 * 1000; // 1 hour — the upstream JSON is static
const SRC = "https://raw.githubusercontent.com/AidanWelch/OpenTrafficCamMap/master/cameras/USA.json";

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const store = getStore("darvis-falcon-eye");
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  const state = url.searchParams.get("state"); // optional: filter to one state

  const cacheKey = `usa-cams:${state || "all"}:${all ? "full" : "thin"}`;
  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  try {
    const res = await fetch(SRC, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return Response.json({ cams: [], error: `github ${res.status}` });
    const data = await res.json();

    const cams = [];
    for (const [stateName, counties] of Object.entries(data)) {
      if (state && stateName.toLowerCase() !== state.toLowerCase()) continue;
      if (!counties || typeof counties !== "object") continue;
      for (const [county, places] of Object.entries(counties)) {
        if (!Array.isArray(places)) continue;
        for (const p of places) {
          const lat = parseFloat(p.latitude);
          const lon = parseFloat(p.longitude);
          if (isNaN(lat) || isNaN(lon) || !p.url) continue;
          const isHls = /\.m3u8/i.test(p.url) || (p.format || "").toUpperCase() === "M3U8";
          cams.push({
            id: `otcm-${stateName}-${county}-${cams.length}`,
            label: `${p.description || "Traffic Cam"} · ${stateName}${p.direction ? " " + p.direction : ""}`,
            lat, lon,
            kind: isHls ? "hls" : "iframe",
            url: p.url,
            state: stateName,
            county,
            source: "usa-dot",
          });
        }
      }
    }

    // Thin the list unless ?all=1 so mobile + initial load stays fast
    const out = all ? cams : cams.filter((_, i) => i % 8 === 0);
    const payload = {
      cams: out,
      total: cams.length,
      shown: out.length,
      source: "OpenTrafficCamMap / USA DOT",
      ts: Date.now(),
    };
    try { await store.setJSON(cacheKey, { data: payload, ts: Date.now() }); } catch {}
    return Response.json(payload);
  } catch (e) {
    return Response.json({ cams: [], error: String(e) });
  }
};

export const config = { path: "/api/falcon-eye/usa-cams" };
