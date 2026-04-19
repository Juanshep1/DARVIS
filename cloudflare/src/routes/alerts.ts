import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON, kvSetJSON } from "../lib/kv";

interface Alert { id: string; type: string; config: Record<string, unknown>; active: boolean }

export const alertsRoutes = new Hono<{ Bindings: Env }>();

// /api/alerts/triggered — polled by browser/iOS
alertsRoutes.get("/triggered", async (c) => {
  const triggered = (await kvGetJSON<unknown[]>(c.env, "alerts", "triggered")) || [];
  await kvSetJSON(c.env, "alerts", "triggered", []);
  return c.json({ triggered });
});

alertsRoutes.post("/triggered", async (c) => {
  const body = await c.req.json<{ triggered?: unknown[] }>().catch(() => ({} as { triggered?: unknown[] }));
  if (Array.isArray(body.triggered)) {
    const existing = ((await kvGetJSON<unknown[]>(c.env, "alerts", "triggered")) || []).slice();
    existing.push(...body.triggered);
    await kvSetJSON(c.env, "alerts", "triggered", existing);
  }
  return c.json({ ok: true });
});

// /api/alerts
alertsRoutes.get("/", async (c) => {
  const alerts = ((await kvGetJSON<Alert[]>(c.env, "alerts", "all")) || []).filter((a) => a.active);
  return c.json({ alerts });
});

alertsRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (body.replace && Array.isArray(body.alerts)) {
    await kvSetJSON(c.env, "alerts", "all", body.alerts);
    return c.json({ ok: true });
  }
  if (!body.type) return c.json({ error: "Need type" }, 400);
  const alerts = ((await kvGetJSON<Alert[]>(c.env, "alerts", "all")) || []).slice();
  const id = (body.id as string) || Math.random().toString(36).slice(2, 10);
  alerts.push({ id, type: body.type as string, config: (body.config as Record<string, unknown>) || {}, active: true });
  await kvSetJSON(c.env, "alerts", "all", alerts);
  return c.json({ ok: true, id });
});

alertsRoutes.delete("/", async (c) => {
  const body = await c.req.json<{ id?: string }>().catch(() => ({} as { id?: string }));
  if (body.id) {
    let alerts = ((await kvGetJSON<Alert[]>(c.env, "alerts", "all")) || []).slice();
    alerts = alerts.filter((a) => a.id !== body.id);
    await kvSetJSON(c.env, "alerts", "all", alerts);
  }
  return c.json({ ok: true });
});
