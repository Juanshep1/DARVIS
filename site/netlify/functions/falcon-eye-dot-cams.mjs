import { getStore } from "@netlify/blobs";

const CACHE_MS = 10 * 60 * 1000;

// Free, no-key US DOT traffic camera sources. All return JPG snapshots that
// refresh every 5-15 seconds — not true HLS, but "live now" in practical
// terms. Each district has ~700 cams.
const CALTRANS_DISTRICTS = ["d3", "d4", "d5", "d6", "d7", "d8", "d10", "d11", "d12"];

async function fetchCaltrans(district) {
  try {
    const r = await fetch(`https://cwwp2.dot.ca.gov/data/${district}/cctv/cctvStatus${district.toUpperCase()}.json`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.data || []).map((item) => {
      const c = item.cctv;
      if (!c) return null;
      const loc = c.location || {};
      const lat = parseFloat(loc.latitude);
      const lon = parseFloat(loc.longitude);
      if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) return null;
      const hls = c.imageData?.streamingVideoURL;
      const img = c.imageData?.static?.currentImageURL;
      if (!hls && !img) return null;
      // Prefer HLS — truly live video. Fall back to JPG snapshot.
      return {
        id: `caltrans-${district}-${c.index || loc.locationName}`,
        label: `${loc.locationName || "Caltrans CCTV"} (${district.toUpperCase()})`,
        lat, lon,
        kind: hls ? "hls" : "jpg",
        url: hls || img,
        snapshotUrl: img || null,
        source: "caltrans",
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const store = getStore("darvis-falcon-eye");
  try {
    const cached = await store.get("dot-cams", { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  const results = await Promise.allSettled(CALTRANS_DISTRICTS.map(fetchCaltrans));
  const cams = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  // Show ALL Caltrans cams by default now — they are mostly live and the
  // user needs a good chance of clicking one that works. ?thin=1 reduces.
  const url = new URL(req.url);
  const thin = url.searchParams.get("thin") === "1";
  const out = thin ? cams.filter((_, i) => i % 4 === 0) : cams;

  const payload = { cams: out, total: cams.length, shown: out.length, source: "caltrans", ts: Date.now() };
  try { await store.setJSON("dot-cams", { data: payload, ts: Date.now() }); } catch {}
  return Response.json(payload);
};

export const config = { path: "/api/falcon-eye/dot-cams" };
