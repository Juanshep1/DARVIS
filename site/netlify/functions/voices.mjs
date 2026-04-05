import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ELEVENLABS_KEY = Netlify.env.get("ELEVENLABS_API_KEY");
  const store = getStore("darvis-settings");

  let currentVoice = Netlify.env.get("DARVIS_VOICE_ID") || "kPtEHAvRnjUJFv7SK9WI";
  try {
    const data = await store.get("current", { type: "json" });
    if (data?.voice_id) currentVoice = data.voice_id;
  } catch {}

  let voices = [];
  if (ELEVENLABS_KEY) {
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": ELEVENLABS_KEY },
      });
      if (res.ok) {
        const data = await res.json();
        voices = (data.voices || []).map((v) => ({
          id: v.voice_id,
          name: v.name,
          category: v.category || "",
        }));
      }
    } catch {}
  }

  return Response.json({ voices, current: currentVoice });
};

export const config = { path: "/api/voices" };
