import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON, kvSetJSON } from "../lib/kv";

interface Task { id?: string; task?: string; completed?: boolean; execute_at?: string }

export const schedulerRoutes = new Hono<{ Bindings: Env }>();

schedulerRoutes.get("/", async (c) => {
  const tasks = ((await kvGetJSON<Task[]>(c.env, "scheduler", "tasks")) || []).filter((t) => !t.completed);
  return c.json({ tasks });
});

schedulerRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (body.replace && Array.isArray(body.tasks)) {
    await kvSetJSON(c.env, "scheduler", "tasks", body.tasks);
    return c.json({ ok: true, count: (body.tasks as Task[]).length });
  }
  if (!body.task) return c.json({ error: "No task" }, 400);
  const tasks = ((await kvGetJSON<Task[]>(c.env, "scheduler", "tasks")) || []).slice();
  const existing = tasks.findIndex((t) => t.id === (body.id as string));
  if (existing >= 0) tasks[existing] = body as Task;
  else tasks.push(body as Task);
  await kvSetJSON(c.env, "scheduler", "tasks", tasks);
  return c.json({ ok: true });
});

schedulerRoutes.delete("/", async (c) => {
  const body = await c.req.json<{ id?: string }>().catch(() => ({} as { id?: string }));
  if (body.id) {
    let tasks = ((await kvGetJSON<Task[]>(c.env, "scheduler", "tasks")) || []).slice();
    tasks = tasks.filter((t) => t.id !== body.id);
    await kvSetJSON(c.env, "scheduler", "tasks", tasks);
  } else {
    await kvSetJSON(c.env, "scheduler", "tasks", []);
  }
  return c.json({ ok: true });
});
