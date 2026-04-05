import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("darvis-memory");

  // GET — return all memories
  if (req.method === "GET") {
    let memories = [];
    try {
      const data = await store.get("all", { type: "json" });
      if (Array.isArray(data)) memories = data;
    } catch {}
    return Response.json({ memories });
  }

  // POST — add a memory
  if (req.method === "POST") {
    const body = await req.json();
    if (!body.content) {
      return Response.json({ error: "No content" }, { status: 400 });
    }

    let memories = [];
    try {
      const data = await store.get("all", { type: "json" });
      if (Array.isArray(data)) memories = data;
    } catch {}

    const entry = {
      id: memories.length > 0 ? Math.max(...memories.map((m) => m.id)) + 1 : 0,
      content: body.content,
      category: body.category || "general",
      created: new Date().toISOString(),
    };
    memories.push(entry);
    await store.setJSON("all", memories);
    return Response.json({ memory: entry });
  }

  // DELETE — remove a memory by id
  if (req.method === "DELETE") {
    const body = await req.json();
    const id = body.id;
    if (id === undefined) {
      return Response.json({ error: "No id" }, { status: 400 });
    }

    let memories = [];
    try {
      const data = await store.get("all", { type: "json" });
      if (Array.isArray(data)) memories = data;
    } catch {}

    memories = memories.filter((m) => m.id !== id);
    // Re-index
    memories.forEach((m, i) => (m.id = i));
    await store.setJSON("all", memories);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/memory" };
