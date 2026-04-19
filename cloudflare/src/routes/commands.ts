import { Hono } from "hono";
import type { Env } from "../env";
import { kvDelete, kvGetJSON, kvSetJSON } from "../lib/kv";

export const commandsRoutes = new Hono<{ Bindings: Env }>();

commandsRoutes.get("/", async (c) => {
  if (c.req.query("local_chat")) {
    const chatReq = await kvGetJSON(c.env, "agent", "pending_local_chat");
    if (chatReq) await kvDelete(c.env, "agent", "pending_local_chat");
    return c.json({ local_chat: chatReq });
  }
  let commands = (await kvGetJSON<unknown[]>(c.env, "agent", "pending_commands")) || [];
  if (commands.length > 0) {
    await kvSetJSON(c.env, "agent", "pending_commands", []);
  }
  return c.json({ commands });
});

commandsRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (body.action === "store_local_response" && body.id && body.reply) {
    await kvSetJSON(c.env, "agent", "local_chat_response", { id: body.id, reply: body.reply });
    return c.json({ ok: true });
  }
  if (body.command) {
    const commands = ((await kvGetJSON<unknown[]>(c.env, "agent", "pending_commands")) || []).slice();
    commands.push(body.command);
    await kvSetJSON(c.env, "agent", "pending_commands", commands);
  }
  return c.json({ ok: true });
});

commandsRoutes.delete("/", async (c) => {
  await kvSetJSON(c.env, "agent", "pending_commands", []);
  return c.json({ ok: true });
});
