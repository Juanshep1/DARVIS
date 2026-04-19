import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON, kvSetJSON } from "../lib/kv";

export const macrosRoutes = new Hono<{ Bindings: Env }>();

macrosRoutes.get("/", async (c) => {
  const macros = (await kvGetJSON<Record<string, string>>(c.env, "macros", "all")) || {};
  return c.json({ macros });
});

macrosRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (body.replace && body.macros) {
    await kvSetJSON(c.env, "macros", "all", body.macros);
    return c.json({ ok: true });
  }
  if (!body.name || !body.command) return c.json({ error: "Need name and command" }, 400);
  const macros = ((await kvGetJSON<Record<string, string>>(c.env, "macros", "all")) || {}) as Record<string, string>;
  macros[(body.name as string).toLowerCase()] = body.command as string;
  await kvSetJSON(c.env, "macros", "all", macros);
  return c.json({ ok: true });
});

macrosRoutes.delete("/", async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  if (!body.name) return c.json({ error: "Need name" }, 400);
  const macros = ((await kvGetJSON<Record<string, string>>(c.env, "macros", "all")) || {}) as Record<string, string>;
  delete macros[body.name.toLowerCase()];
  await kvSetJSON(c.env, "macros", "all", macros);
  return c.json({ ok: true });
});
