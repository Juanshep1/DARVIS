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

  // Use a manual AbortController so we can stop as soon as we have what we
  // need (critical for MJPEG streams which never EOF on their own).
  const ac = new AbortController();
  const watchdog = setTimeout(() => ac.abort(), 8000);

  let upstream;
  try {
    upstream = await fetch(fetchUrl, { headers, redirect: "follow", signal: ac.signal });
  } catch {
    clearTimeout(watchdog);
    return offlinePlaceholder();
  }

  if (!upstream.ok) { clearTimeout(watchdog); return offlinePlaceholder(); }

  const ct = upstream.headers.get("content-type") || "";
  const isMultipart = /multipart\/x-mixed-replace/i.test(ct);
  const isImage = ct.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(decoded);

  if (!isImage && !isMultipart) {
    // Some Axis/Dahua URLs return an image despite a generic content-type.
    // If the URL doesn't look image-ish, bail.
    if (!/jpg|jpeg|image|snap|oneshot|webcapture|cgi/i.test(decoded)) {
      clearTimeout(watchdog);
      try { ac.abort(); } catch {}
      return offlinePlaceholder();
    }
  }

  // Stream-read chunks; for MJPEG stop at the first complete JPEG frame
  // (SOI 0xFFD8 .. EOI 0xFFD9). For plain JPG fall back to reading all
  // chunks but cap at 4 MB to avoid memory blow-ups on pathological feeds.
  const MAX_BYTES = 4 * 1024 * 1024;
  const reader = upstream.body?.getReader();
  if (!reader) {
    clearTimeout(watchdog);
    return offlinePlaceholder();
  }

  const chunks = [];
  let total = 0;
  let frame = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total > MAX_BYTES) break;

      if (isMultipart) {
        // Scan concatenated buffer for a complete JPEG
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
        let start = -1;
        for (let i = 0; i < merged.length - 1; i++) {
          if (merged[i] === 0xff && merged[i + 1] === 0xd8) { start = i; break; }
        }
        if (start !== -1) {
          let end = -1;
          for (let i = start + 2; i < merged.length - 1; i++) {
            if (merged[i] === 0xff && merged[i + 1] === 0xd9) { end = i + 2; break; }
          }
          if (end !== -1) {
            frame = merged.slice(start, end);
            break;
          }
        }
      }
    }
  } catch {
    // swallow — we may already have a usable frame
  } finally {
    clearTimeout(watchdog);
    try { await reader.cancel(); } catch {}
    try { ac.abort(); } catch {}
  }

  if (isMultipart) {
    if (!frame) return offlinePlaceholder();
    return new Response(frame, {
      status: 200,
      headers: corsHeaders({
        "Content-Type": "image/jpeg",
        "Content-Length": String(frame.byteLength),
        "Cache-Control": "public, max-age=2, s-maxage=2",
        "X-FalconEye-MJPEG": "1",
      }),
    });
  }

  if (total === 0) return offlinePlaceholder();
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }

  return new Response(merged, {
    status: 200,
    headers: corsHeaders({
      "Content-Type": ct || "image/jpeg",
      "Content-Length": String(merged.byteLength),
      "Cache-Control": "public, max-age=5, s-maxage=5",
    }),
  });
};

export const config = { path: "/api/falcon-eye/cam-snap" };
