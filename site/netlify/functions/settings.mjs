import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("darvis-settings");

  if (req.method === "GET") {
    let settings = {};
    try {
      const data = await store.get("current", { type: "json" });
      if (data) settings = data;
    } catch {}
    return Response.json({
      model: settings.model || Netlify.env.get("DARVIS_MODEL") || "llama3.3:70b",
      voice_id: settings.voice_id || Netlify.env.get("DARVIS_VOICE_ID") || "kPtEHAvRnjUJFv7SK9WI",
      audio_mode: settings.audio_mode || "classic",
    });
  }

  if (req.method === "POST") {
    const body = await req.json();
    let settings = {};
    try {
      const data = await store.get("current", { type: "json" });
      if (data) settings = data;
    } catch {}

    if (body.model) settings.model = body.model;
    if (body.voice_id) settings.voice_id = body.voice_id;
    if (body.audio_mode) settings.audio_mode = body.audio_mode;

    await store.setJSON("current", settings);
    return Response.json(settings);
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/settings" };
