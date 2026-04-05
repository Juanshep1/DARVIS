import { getStore } from "@netlify/blobs";

const MAX_MESSAGES = 40; // Keep last 40 messages (20 exchanges)

export default async (req) => {
  const store = getStore("darvis-history");

  // GET — return conversation history
  if (req.method === "GET") {
    let messages = [];
    try {
      const data = await store.get("conversation", { type: "json" });
      if (Array.isArray(data)) messages = data;
    } catch {}
    return Response.json({ messages });
  }

  // POST — append messages to history
  if (req.method === "POST") {
    const body = await req.json();
    const newMessages = body.messages;
    if (!Array.isArray(newMessages)) {
      return Response.json({ error: "messages must be an array" }, { status: 400 });
    }

    let messages = [];
    try {
      const data = await store.get("conversation", { type: "json" });
      if (Array.isArray(data)) messages = data;
    } catch {}

    messages.push(...newMessages);

    // Trim to max, keeping pairs intact
    if (messages.length > MAX_MESSAGES) {
      messages = messages.slice(-MAX_MESSAGES);
    }

    await store.setJSON("conversation", messages);
    return Response.json({ ok: true, count: messages.length });
  }

  // DELETE — clear history
  if (req.method === "DELETE") {
    await store.setJSON("conversation", []);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/history" };
