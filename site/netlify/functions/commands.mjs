import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("darvis-agent");

  if (req.method === "GET") {
    const url = new URL(req.url);

    // Local chat polling — daemon checks for pending local chat requests
    if (url.searchParams.get("local_chat")) {
      let chatReq = null;
      try {
        chatReq = await store.get("pending_local_chat", { type: "json" });
        if (chatReq) {
          await store.delete("pending_local_chat");
        }
      } catch {}
      return Response.json({ local_chat: chatReq });
    }

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

    // Store local chat response from daemon
    if (body.action === "store_local_response" && body.id && body.reply) {
      await store.setJSON("local_chat_response", { id: body.id, reply: body.reply });
      return Response.json({ ok: true });
    }

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
