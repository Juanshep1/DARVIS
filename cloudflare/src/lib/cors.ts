import type { Context, Next } from "hono";

// Permissive CORS middleware — the frontend can live on any origin.
// Preflight handled; responses get the CORS headers injected.
export async function cors(c: Context, next: Next) {
  const origin = c.req.header("Origin") || "*";
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Requested-With",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
      },
    });
  }
  await next();
  c.res.headers.set("Access-Control-Allow-Origin", origin);
  c.res.headers.set("Vary", "Origin");
}
