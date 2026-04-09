import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("darvis-macros");

  if (req.method === "GET") {
    let macros = {};
    try {
      const data = await store.get("all", { type: "json" });
      if (data && typeof data === "object") macros = data;
    } catch {}
    return Response.json({ macros });
  }

  if (req.method === "POST") {
    const body = await req.json();

    // Full replacement from terminal sync
    if (body.replace && body.macros) {
      await store.setJSON("all", body.macros);
      return Response.json({ ok: true });
    }

    // Single macro add
    if (!body.name || !body.command) {
      return Response.json({ error: "Need name and command" }, { status: 400 });
    }

    let macros = {};
    try {
      const data = await store.get("all", { type: "json" });
      if (data) macros = data;
    } catch {}

    macros[body.name.toLowerCase()] = body.command;
    await store.setJSON("all", macros);
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE") {
    const body = await req.json();
    if (!body.name) return Response.json({ error: "Need name" }, { status: 400 });

    let macros = {};
    try {
      const data = await store.get("all", { type: "json" });
      if (data) macros = data;
    } catch {}

    delete macros[body.name.toLowerCase()];
    await store.setJSON("all", macros);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/macros" };
