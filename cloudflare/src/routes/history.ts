import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON, kvSetJSON } from "../lib/kv";

const MAX_MESSAGES = 40;

interface Msg { role: string; content: string }

export const historyRoutes = new Hono<{ Bindings: Env }>();

historyRoutes.get("/", async (c) => {
  const messages = (await kvGetJSON<Msg[]>(c.env, "history", "conversation")) || [];
  return c.json({ messages });
});

historyRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({} as { messages?: Msg[] }));
  if (!Array.isArray(body.messages)) return c.json({ error: "messages must be an array" }, 400);
  let messages = (await kvGetJSON<Msg[]>(c.env, "history", "conversation")) || [];
  messages.push(...body.messages);
  if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
  await kvSetJSON(c.env, "history", "conversation", messages);
  return c.json({ ok: true, count: messages.length });
});

historyRoutes.delete("/", async (c) => {
  await kvSetJSON(c.env, "history", "conversation", []);
  return c.json({ ok: true });
});
