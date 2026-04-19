import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON, kvSetJSON } from "../lib/kv";

interface Memory {
  id: number;
  content: string;
  category: string;
  created: string;
}

export const memoryRoutes = new Hono<{ Bindings: Env }>();

memoryRoutes.get("/", async (c) => {
  const memories = (await kvGetJSON<Memory[]>(c.env, "memory", "all")) || [];
  return c.json({ memories });
});

memoryRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({} as { content?: string; category?: string }));
  if (!body.content) return c.json({ error: "No content" }, 400);
  const memories = (await kvGetJSON<Memory[]>(c.env, "memory", "all")) || [];
  const entry: Memory = {
    id: memories.length > 0 ? Math.max(...memories.map((m) => m.id)) + 1 : 0,
    content: body.content,
    category: body.category || "general",
    created: new Date().toISOString(),
  };
  memories.push(entry);
  await kvSetJSON(c.env, "memory", "all", memories);
  return c.json({ memory: entry });
});

memoryRoutes.delete("/", async (c) => {
  const body = await c.req.json().catch(() => ({} as { id?: number }));
  if (body.id === undefined) return c.json({ error: "No id" }, 400);
  let memories = (await kvGetJSON<Memory[]>(c.env, "memory", "all")) || [];
  memories = memories.filter((m) => m.id !== body.id);
  memories.forEach((m, i) => (m.id = i));
  await kvSetJSON(c.env, "memory", "all", memories);
  return c.json({ ok: true });
});
