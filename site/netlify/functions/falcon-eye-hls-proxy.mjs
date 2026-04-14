// HLS proxy — rewrites m3u8 playlists so every segment fetch goes through
// this same origin (with Access-Control-Allow-Origin: *). Lets hls.js play
// cross-origin HLS streams (DOT traffic cams, state webcams etc.) that
// don't set CORS headers. Safari's native <video> doesn't need this and
// should be used directly.
//
// Hardening passes:
//   ?healthz=1           → liveness probe, returns {ok, ts}
//   ?referer=<url>       → spoof Referer for upstreams that 403 without one
//   ?origin=<url>        → spoof Origin for upstreams that require it
// JSON error shape on upstream failure so hls.js / wall can show a real msg.

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "Content-Type, Content-Length, X-Cache, X-Upstream-Status",
    ...extra,
  };
}

function errorJson(kind, msg, status, extra = {}) {
  return new Response(
    JSON.stringify({ error: kind, message: msg, ...extra, ts: Date.now() }),
    { status, headers: corsHeaders({ "Content-Type": "application/json" }) }
  );
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  const reqUrl = new URL(req.url);

  // Health probe — lets the wall / monitoring ping this without a url param.
  if (reqUrl.searchParams.get("healthz") === "1") {
    return new Response(
      JSON.stringify({ ok: true, service: "falcon-eye-hls-proxy", ts: Date.now() }),
      { status: 200, headers: corsHeaders({ "Content-Type": "application/json" }) }
    );
  }

  if (req.method !== "GET") {
    return errorJson("method_not_allowed", "only GET is supported", 405);
  }

  const target = reqUrl.searchParams.get("url");
  if (!target) return errorJson("missing_url", "url query param required", 400);

  let decoded;
  try { decoded = decodeURIComponent(target); } catch { decoded = target; }

  // Hard safety: only allow http(s) origins
  if (!/^https?:\/\//i.test(decoded)) {
    return errorJson("invalid_url", "only http(s) urls allowed", 400, { url: decoded });
  }

  // Optional header spoofing for upstreams that demand a referer/origin
  const spoofReferer = reqUrl.searchParams.get("referer");
  const spoofOrigin = reqUrl.searchParams.get("origin");

  const upstreamHeaders = {
    "User-Agent": "Mozilla/5.0 (FalconEye HLS Proxy)",
    "Accept": "*/*",
  };
  if (spoofReferer) upstreamHeaders["Referer"] = spoofReferer;
  if (spoofOrigin) upstreamHeaders["Origin"] = spoofOrigin;

  let upstream;
  try {
    upstream = await fetch(decoded, {
      headers: upstreamHeaders,
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    return errorJson("upstream_fetch_failed", String(e?.message || e), 502, { url: decoded });
  }

  if (!upstream.ok && upstream.status >= 400) {
    // Give the caller a structured hint so they can retry with ?referer= etc.
    if (upstream.status === 403 || upstream.status === 401) {
      return errorJson("upstream_forbidden", `upstream returned ${upstream.status}`, 502,
        { url: decoded, status: upstream.status, hint: "try adding ?referer= or ?origin=" });
    }
    if (upstream.status === 404) {
      return errorJson("upstream_not_found", "upstream 404 — stream may be dead", 502,
        { url: decoded, status: upstream.status });
    }
    // Other 4xx/5xx: still fall through to normal handling below so partial
    // bodies reach the client (hls.js needs to see the error body sometimes).
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

    // Preserve the referer/origin spoof downstream so segment fetches keep working
    const spoofQuery =
      (spoofReferer ? `&referer=${encodeURIComponent(spoofReferer)}` : "") +
      (spoofOrigin ? `&origin=${encodeURIComponent(spoofOrigin)}` : "");

    const rewrite = (u) => {
      if (!base) return u;
      try {
        const abs = new URL(u, base).toString();
        return proxyBase + encodeURIComponent(abs) + spoofQuery;
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
