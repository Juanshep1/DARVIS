import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON } from "../lib/kv";

export const voicesRoute = new Hono<{ Bindings: Env }>();

voicesRoute.get("/", async (c) => {
  const settings = await kvGetJSON<{ voice_id?: string }>(c.env, "settings", "current");
  const current = settings?.voice_id || c.env.DARVIS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

  let voices: { id: string; name: string; category: string }[] = [];
  if (c.env.ELEVENLABS_API_KEY) {
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": c.env.ELEVENLABS_API_KEY },
      });
      if (res.ok) {
        const data = (await res.json()) as { voices?: { voice_id: string; name: string; category?: string }[] };
        voices = (data.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category || "" }));
      }
    } catch {}
  }
  return c.json({ voices, current });
});
