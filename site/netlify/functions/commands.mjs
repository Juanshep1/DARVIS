import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("darvis-agent");

  if (req.method === "GET") {
    let commands = [];
    try {
      const data = await store.get("pending_commands", { type: "json" });
      if (Array.isArray(data)) commands = data;
      // Clear after reading so terminal doesn't re-execute
      if (commands.length > 0) {
        await store.setJSON("pending_commands", []);
      }
    } catch {}
    return Response.json({ commands });
  }

  if (req.method === "POST") {
    const body = await req.json();
    if (body.command) {
      let commands = [];
      try {
        const data = await store.get("pending_commands", { type: "json" });
        if (Array.isArray(data)) commands = data;
      } catch {}
      commands.push(body.command);
      await store.setJSON("pending_commands", commands);
    }
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE") {
    await store.setJSON("pending_commands", []);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/commands" };
