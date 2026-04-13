import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("darvis-falcon-eye");

  if (req.method === "GET") {
    try {
      const data = await store.get("pending_command", { type: "json" });
      if (data?.command) {
        await store.delete("pending_command");
        return Response.json(data);
      }
    } catch {}
    return Response.json({ command: null });
  }

  if (req.method === "POST") {
    const body = await req.json();
    if (!body || !body.intent) {
      return Response.json({ error: "Missing intent" }, { status: 400 });
    }
    const command = {
      id: body.id || crypto.randomUUID(),
      intent: body.intent,
      region: body.region || null,
      lat: typeof body.lat === "number" ? body.lat : null,
      lon: typeof body.lon === "number" ? body.lon : null,
      zoom: typeof body.zoom === "number" ? body.zoom : null,
      query: body.query || null,
      layer: body.layer || null,
      url: body.url || null,
      label: body.label || null,
      ts: Date.now(),
    };
    await store.setJSON("pending_command", { command, ts: command.ts });
    return Response.json({ ok: true, command });
  }

  if (req.method === "DELETE") {
    await store.delete("pending_command");
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/falcon-eye/command" };
