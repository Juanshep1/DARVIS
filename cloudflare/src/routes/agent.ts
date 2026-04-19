import { Hono } from "hono";
import type { Env } from "../env";
import { kvDelete, kvGetJSON, kvSetJSON } from "../lib/kv";

export const agentRoutes = new Hono<{ Bindings: Env }>();

// ── /api/agent/screenshot ──
agentRoutes.get("/screenshot", async (c) => {
  const data = await kvGetJSON<{ screenshot?: string }>(c.env, "agent", "screenshot");
  if (!data?.screenshot) return new Response(null, { status: 204 });
  // Base64 → raw bytes
  const bin = atob(data.screenshot);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-cache, no-store" },
  });
});

agentRoutes.post("/screenshot", async (c) => {
  const body = await c.req.json<{ screenshot?: string }>().catch(() => ({} as { screenshot?: string }));
  if (!body.screenshot) return c.json({ error: "No screenshot" }, 400);
  await kvSetJSON(c.env, "agent", "screenshot", { screenshot: body.screenshot, ts: Date.now() });
  return c.json({ ok: true });
});

// ── /api/agent/status ──
agentRoutes.get("/status", async (c) => {
  const status = await kvGetJSON<Record<string, unknown>>(c.env, "agent", "status");
  return c.json(status || { active: false, goal: "", step: 0, thinking: "", actions: [], done: false });
});

agentRoutes.post("/status", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  await kvSetJSON(c.env, "agent", "status", body);
  return c.json({ ok: true });
});

agentRoutes.delete("/status", async (c) => {
  await kvSetJSON(c.env, "agent", "status", { active: false, goal: "", step: 0, thinking: "", actions: [], done: false });
  await kvDelete(c.env, "agent", "screenshot");
  return c.json({ ok: true });
});

// ── /api/agent/goal ──
agentRoutes.get("/goal", async (c) => {
  const data = await kvGetJSON<{ goal?: string; ts?: number }>(c.env, "agent", "pending_goal");
  if (data?.goal) {
    await kvDelete(c.env, "agent", "pending_goal");
    return c.json(data);
  }
  return c.json({ goal: null });
});

agentRoutes.post("/goal", async (c) => {
  const body = await c.req.json<{ goal?: string }>().catch(() => ({} as { goal?: string }));
  if (!body.goal) return c.json({ error: "No goal" }, 400);
  await kvSetJSON(c.env, "agent", "pending_goal", { goal: body.goal, ts: Date.now() });
  return c.json({ ok: true });
});
