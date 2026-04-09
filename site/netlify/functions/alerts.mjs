import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("darvis-alerts");
  const url = new URL(req.url);

  // GET /api/alerts/triggered — for browser/iOS polling
  if (url.pathname === "/api/alerts/triggered" && req.method === "GET") {
    let triggered = [];
    try {
      const data = await store.get("triggered", { type: "json" });
      if (Array.isArray(data)) triggered = data;
      // Clear after reading
      await store.setJSON("triggered", []);
    } catch {}
    return Response.json({ triggered });
  }

  // POST /api/alerts/triggered — from terminal pushing triggered alerts
  if (url.pathname === "/api/alerts/triggered" && req.method === "POST") {
    const body = await req.json();
    if (body.triggered) {
      let existing = [];
      try {
        const data = await store.get("triggered", { type: "json" });
        if (Array.isArray(data)) existing = data;
      } catch {}
      existing.push(...body.triggered);
      await store.setJSON("triggered", existing);
    }
    return Response.json({ ok: true });
  }

  // GET /api/alerts
  if (req.method === "GET") {
    let alerts = [];
    try {
      const data = await store.get("all", { type: "json" });
      if (Array.isArray(data)) alerts = data.filter((a) => a.active);
    } catch {}
    return Response.json({ alerts });
  }

  // POST /api/alerts
  if (req.method === "POST") {
    const body = await req.json();

    if (body.replace && Array.isArray(body.alerts)) {
      await store.setJSON("all", body.alerts);
      return Response.json({ ok: true });
    }

    if (!body.type) return Response.json({ error: "Need type" }, { status: 400 });

    let alerts = [];
    try {
      const data = await store.get("all", { type: "json" });
      if (Array.isArray(data)) alerts = data;
    } catch {}

    const id = body.id || Math.random().toString(36).slice(2, 10);
    alerts.push({ id, type: body.type, config: body.config || {}, active: true });
    await store.setJSON("all", alerts);
    return Response.json({ ok: true, id });
  }

  // DELETE /api/alerts
  if (req.method === "DELETE") {
    const body = await req.json();
    if (body.id) {
      let alerts = [];
      try {
        const data = await store.get("all", { type: "json" });
        if (Array.isArray(data)) alerts = data;
      } catch {}
      alerts = alerts.filter((a) => a.id !== body.id);
      await store.setJSON("all", alerts);
    }
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: ["/api/alerts", "/api/alerts/triggered"] };
