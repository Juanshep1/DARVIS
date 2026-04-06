import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("darvis-agent");
  const url = new URL(req.url);
  const path = url.pathname;

  // ── Screenshot ──
  if (path === "/api/agent/screenshot") {
    if (req.method === "GET") {
      try {
        const data = await store.get("screenshot", { type: "json" });
        if (data?.screenshot) {
          const imgBytes = Uint8Array.from(atob(data.screenshot), c => c.charCodeAt(0));
          return new Response(imgBytes, {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "no-cache, no-store",
            },
          });
        }
      } catch {}
      return new Response(null, { status: 204 });
    }

    if (req.method === "POST") {
      const body = await req.json();
      if (body.screenshot) {
        await store.setJSON("screenshot", { screenshot: body.screenshot, ts: Date.now() });
        return Response.json({ ok: true });
      }
      return Response.json({ error: "No screenshot" }, { status: 400 });
    }
  }

  // ── Status ──
  if (path === "/api/agent/status") {
    if (req.method === "GET") {
      let status = { active: false, goal: "", step: 0, thinking: "", actions: [], done: false };
      try {
        const data = await store.get("status", { type: "json" });
        if (data) status = data;
      } catch {}
      return Response.json(status);
    }

    if (req.method === "POST") {
      const body = await req.json();
      await store.setJSON("status", body);
      return Response.json({ ok: true });
    }

    if (req.method === "DELETE") {
      await store.setJSON("status", { active: false, goal: "", step: 0, thinking: "", actions: [], done: false });
      await store.delete("screenshot");
      return Response.json({ ok: true });
    }
  }

  // ── Pending goal (for cross-device triggering) ──
  if (path === "/api/agent/goal") {
    if (req.method === "GET") {
      try {
        const data = await store.get("pending_goal", { type: "json" });
        if (data?.goal) {
          // Consume it (one-time read)
          await store.delete("pending_goal");
          return Response.json(data);
        }
      } catch {}
      return Response.json({ goal: null });
    }

    if (req.method === "POST") {
      const body = await req.json();
      if (body.goal) {
        await store.setJSON("pending_goal", { goal: body.goal, ts: Date.now() });
        return Response.json({ ok: true });
      }
      return Response.json({ error: "No goal" }, { status: 400 });
    }
  }

  return new Response("Not found", { status: 404 });
};

export const config = {
  path: ["/api/agent/screenshot", "/api/agent/status", "/api/agent/goal"],
};
