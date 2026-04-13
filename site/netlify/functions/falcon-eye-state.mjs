import { getStore } from "@netlify/blobs";

const DEFAULT_STATE = {
  active: false,
  focus: null,
  layers: { satellites: true, aircraft: true, cameras: true, news: true },
  tracked: null,
  ts: 0,
};

export default async (req) => {
  const store = getStore("darvis-falcon-eye");

  if (req.method === "GET") {
    try {
      const data = await store.get("state", { type: "json" });
      if (data) return Response.json(data);
    } catch {}
    return Response.json(DEFAULT_STATE);
  }

  if (req.method === "POST") {
    const body = await req.json();
    const state = { ...DEFAULT_STATE, ...body, ts: Date.now() };
    await store.setJSON("state", state);
    return Response.json({ ok: true, state });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/falcon-eye/state" };
