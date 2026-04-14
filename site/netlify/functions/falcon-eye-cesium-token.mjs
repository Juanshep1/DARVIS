// Returns the Cesium ion access token to the Falcon Eye page so the token
// is never baked into the public HTML. Set via:
//   netlify env:set CESIUM_ION_TOKEN <token>

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const token = Netlify.env.get("CESIUM_ION_TOKEN");
  if (!token) return Response.json({ token: null, error: "no CESIUM_ION_TOKEN configured" });
  return Response.json({ token }, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
};

export const config = { path: "/api/falcon-eye/cesium-token" };
