import { getStore } from "@netlify/blobs";

// Liveness probe for camera feeds. HEAD-checks the upstream URL and caches
// the result in Netlify Blobs for 5 minutes per URL hash so the CCTV wall
// can render alive/dead indicators without pounding origins.
//
// GET /api/falcon-eye/cam-status?url=<encoded>         → single probe
// GET /api/falcon-eye/cam-status?urls=<u1>|<u2>|<u3>   → batch (up to 24)
//
// Response shape:
//   single: { url, alive, status, ms, cached, checkedAt }
//   batch:  { results: [ {url, alive, status, ms, cached, checkedAt}, ... ] }

const CACHE_MS = 5 * 60 * 1000;
const MAX_BATCH = 24;
const PROBE_TIMEOUT_MS = 5000;

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Content-Type": "application/json",
    ...extra,
  };
}

// Short stable key for blob storage. URLs can be huge; hash-ish with djb2.
function keyFor(url) {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  return "probe-" + (h >>> 0).toString(36) + "-" + url.length;
}

async function probe(url, store) {
  // Cache lookup
  try {
    const cached = await store.get(keyFor(url), { type: "json" });
    if (cached && Date.now() - cached.checkedAt < CACHE_MS) {
      return { ...cached, url, cached: true };
    }
  } catch {}

  const start = Date.now();
  let status = 0;
  let alive = false;
  try {
    // Try HEAD first — cheapest. Many CDNs reject HEAD though, so fall back
    // to a ranged GET of the first 1 KB.
    let r;
    try {
      r = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": "FalconEye/1.0 CamStatus" },
        redirect: "follow",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
    } catch {
      r = null;
    }
    if (!r || r.status === 405 || r.status === 403) {
      // Fallback: ranged GET
      r = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "FalconEye/1.0 CamStatus",
          "Range": "bytes=0-1023",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      // Consume & discard body so fetch can free the connection
      try { await r.arrayBuffer(); } catch {}
    }
    status = r.status;
    alive = r.status >= 200 && r.status < 400;
  } catch (e) {
    status = 0;
    alive = false;
  }
  const ms = Date.now() - start;
  const entry = { url, alive, status, ms, checkedAt: Date.now(), cached: false };

  // Only cache "alive" results for the full TTL; cache "dead" for half TTL
  // so transient flaps recover quickly.
  try {
    const ttlRecord = alive
      ? entry
      : { ...entry, checkedAt: Date.now() - CACHE_MS / 2 };
    await store.setJSON(keyFor(url), ttlRecord);
  } catch {}

  return entry;
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: cors() });
  }

  const store = getStore("darvis-falcon-eye");
  const u = new URL(req.url);

  const single = u.searchParams.get("url");
  const batch = u.searchParams.get("urls");

  if (!single && !batch) {
    return new Response(
      JSON.stringify({ error: "missing_params", hint: "pass ?url=<u> or ?urls=<u1>|<u2>" }),
      { status: 400, headers: cors() }
    );
  }

  if (single) {
    let decoded;
    try { decoded = decodeURIComponent(single); } catch { decoded = single; }
    if (!/^https?:\/\//i.test(decoded)) {
      return new Response(JSON.stringify({ error: "invalid_url" }), { status: 400, headers: cors() });
    }
    const result = await probe(decoded, store);
    return new Response(JSON.stringify(result), { headers: cors() });
  }

  // Batch mode: pipe-separated for URL cleanliness (commas are common in URLs)
  const urls = batch.split("|").map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  }).filter((s) => /^https?:\/\//i.test(s)).slice(0, MAX_BATCH);

  const results = await Promise.allSettled(urls.map((url) => probe(url, store)));
  const out = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return { url: urls[i], alive: false, status: 0, ms: 0, checkedAt: Date.now(), cached: false, error: String(r.reason) };
  });

  const aliveCount = out.filter((r) => r.alive).length;
  return new Response(
    JSON.stringify({ results: out, total: out.length, alive: aliveCount }),
    { headers: cors() }
  );
};

export const config = { path: "/api/falcon-eye/cam-status" };
