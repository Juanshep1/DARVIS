// Snapshot proxy — fetches a camera JPG/PNG snapshot upstream and returns it
// with CORS headers. Lets the CCTV wall render cams that would otherwise
// refuse direct <img> embed due to CORS, hotlink protection, or require a
// specific Referer / User-Agent.
//
// GET /api/falcon-eye/cam-snap?url=<encoded>
//   optional: &referer=<url>   spoof Referer for hotlink-protected sources
//   optional: &ua=<string>     spoof User-Agent
//
// Response: the image bytes with correct Content-Type and 15s edge cache.
// On failure returns a 1x1 transparent PNG so <img> never shows broken-image
// icons on the wall.

const ONE_PX_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    ...extra,
  };
}

function offlinePlaceholder() {
  return new Response(ONE_PX_PNG, {
    status: 200,
    headers: corsHeaders({
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=30",
      "X-FalconEye-Offline": "1",
    }),
  });
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
  }

  const u = new URL(req.url);
  const target = u.searchParams.get("url");
  if (!target) return new Response("missing url", { status: 400, headers: corsHeaders() });

  let decoded;
  try { decoded = decodeURIComponent(target); } catch { decoded = target; }
  if (!/^https?:\/\//i.test(decoded)) {
    return new Response("invalid url", { status: 400, headers: corsHeaders() });
  }

  const referer = u.searchParams.get("referer");
  const ua = u.searchParams.get("ua") || "Mozilla/5.0 (FalconEye CCTV Wall) AppleWebKit/537.36";

  const headers = { "User-Agent": ua, "Accept": "image/*,*/*;q=0.8" };
  if (referer) headers["Referer"] = referer;

  // Cam snapshots are usually small (<500 KB) and change every few seconds.
  // Add a tiny cache-buster for the upstream so we don't serve CDN-cached stale.
  const sep = decoded.includes("?") ? "&" : "?";
  const fetchUrl = `${decoded}${sep}_t=${Math.floor(Date.now() / 5000)}`;

  let upstream;
  try {
    upstream = await fetch(fetchUrl, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return offlinePlaceholder();
  }

  if (!upstream.ok) return offlinePlaceholder();

  const ct = upstream.headers.get("content-type") || "";
  // Reject anything that isn't an image — some upstreams return HTML 200s
  // when rate-limited or geo-blocked.
  if (!ct.startsWith("image/") && !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(decoded)) {
    return offlinePlaceholder();
  }

  let buf;
  try { buf = await upstream.arrayBuffer(); }
  catch { return offlinePlaceholder(); }

  if (buf.byteLength === 0) return offlinePlaceholder();

  return new Response(buf, {
    status: 200,
    headers: corsHeaders({
      "Content-Type": ct || "image/jpeg",
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "public, max-age=5, s-maxage=5",
    }),
  });
};

export const config = { path: "/api/falcon-eye/cam-snap" };
