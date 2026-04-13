import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("darvis-falcon-eye");

  if (req.method === "GET") {
    try {
      const list = await store.get("cameras", { type: "json" });
      return Response.json(Array.isArray(list) ? list : []);
    } catch {
      return Response.json([]);
    }
  }

  if (req.method === "POST") {
    const body = await req.json();
    if (!body?.url) return Response.json({ error: "Missing url" }, { status: 400 });
    let list = [];
    try { list = (await store.get("cameras", { type: "json" })) || []; } catch {}
    const cam = {
      id: body.id || crypto.randomUUID(),
      url: body.url,
      label: body.label || body.url,
      lat: typeof body.lat === "number" ? body.lat : null,
      lon: typeof body.lon === "number" ? body.lon : null,
      kind: body.kind || (body.url.match(/\.m3u8/i) ? "hls" : body.url.match(/\.(jpg|mjpg|jpeg)/i) ? "mjpeg" : "iframe"),
      ts: Date.now(),
    };
    list.push(cam);
    await store.setJSON("cameras", list);
    return Response.json({ ok: true, camera: cam });
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      await store.setJSON("cameras", []);
      return Response.json({ ok: true });
    }
    let list = [];
    try { list = (await store.get("cameras", { type: "json" })) || []; } catch {}
    list = list.filter((c) => c.id !== id);
    await store.setJSON("cameras", list);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/falcon-eye/cameras" };
