import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("darvis-scheduler");

  if (req.method === "GET") {
    let tasks = [];
    try {
      const data = await store.get("tasks", { type: "json" });
      if (Array.isArray(data)) tasks = data.filter((t) => !t.completed);
    } catch {}
    return Response.json({ tasks });
  }

  if (req.method === "POST") {
    const body = await req.json();

    // Full replacement mode (from terminal sync)
    if (body.replace && Array.isArray(body.tasks)) {
      await store.setJSON("tasks", body.tasks);
      return Response.json({ ok: true, count: body.tasks.length });
    }

    // Single task add
    if (!body.task) return Response.json({ error: "No task" }, { status: 400 });

    let tasks = [];
    try {
      const data = await store.get("tasks", { type: "json" });
      if (Array.isArray(data)) tasks = data;
    } catch {}

    const existing = tasks.findIndex((t) => t.id === body.id);
    if (existing >= 0) {
      tasks[existing] = body;
    } else {
      tasks.push(body);
    }

    await store.setJSON("tasks", tasks);
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE") {
    const body = await req.json();
    if (body.id) {
      let tasks = [];
      try {
        const data = await store.get("tasks", { type: "json" });
        if (Array.isArray(data)) tasks = data;
      } catch {}
      tasks = tasks.filter((t) => t.id !== body.id);
      await store.setJSON("tasks", tasks);
    } else {
      await store.setJSON("tasks", []);
    }
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/scheduler" };
