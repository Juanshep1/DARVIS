// HLS proxy — rewrites m3u8 playlists so every segment fetch goes through
// this same origin (with Access-Control-Allow-Origin: *). Lets hls.js play
// cross-origin HLS streams (DOT traffic cams, state webcams etc.) that
// don't set CORS headers. Safari's native <video> doesn't need this and
// should be used directly.

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    ...extra,
  };
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
  }

  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get("url");
  if (!target) return new Response("missing url", { status: 400, headers: corsHeaders() });

  let decoded;
  try { decoded = decodeURIComponent(target); } catch { decoded = target; }

  // Hard safety: only allow http(s) origins
  if (!/^https?:\/\//i.test(decoded)) {
    return new Response("invalid url", { status: 400, headers: corsHeaders() });
  }

  let upstream;
  try {
    upstream = await fetch(decoded, {
      headers: {
        "User-Agent": "Mozilla/5.0 (FalconEye HLS Proxy)",
        "Accept": "*/*",
      },
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    return new Response(`upstream error: ${e.message}`, { status: 502, headers: corsHeaders() });
  }

  const ct = upstream.headers.get("content-type") || "";
  const isPlaylist = ct.includes("mpegurl") || /\.m3u8(\?|$)/i.test(decoded);

  const proxyBase = "/api/falcon-eye/hls-proxy?url=";

  if (isPlaylist) {
    let text;
    try { text = await upstream.text(); }
    catch (e) { return new Response(`read error: ${e.message}`, { status: 502, headers: corsHeaders() }); }

    let base;
    try { base = new URL(decoded); } catch { base = null; }

    const rewrite = (u) => {
      if (!base) return u;
      try {
        const abs = new URL(u, base).toString();
        return proxyBase + encodeURIComponent(abs);
      } catch { return u; }
    };

    const rewritten = text.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        // Rewrite URI="…" attributes inside tags (EXT-X-KEY, EXT-X-MAP, etc.)
        return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${rewrite(u)}"`);
      }
      // It's a segment URL line
      return rewrite(trimmed);
    }).join("\n");

    return new Response(rewritten, {
      status: upstream.status,
      headers: corsHeaders({
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
      }),
    });
  }

  // Segment (.ts / .m4s / .mp4 / .aac / .vtt / key) — binary pass-through
  let buf;
  try { buf = await upstream.arrayBuffer(); }
  catch (e) { return new Response(`read error: ${e.message}`, { status: 502, headers: corsHeaders() }); }

  return new Response(buf, {
    status: upstream.status,
    headers: corsHeaders({
      "Content-Type": ct || "video/mp2t",
      "Cache-Control": "public, max-age=2",
    }),
  });
};

export const config = { path: "/api/falcon-eye/hls-proxy" };
