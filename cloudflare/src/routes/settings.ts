import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON, kvSetJSON } from "../lib/kv";

interface Settings {
  model?: string;
  voice_id?: string;
  audio_mode?: string;
  openrouter_model?: string;
}

export const settingsRoutes = new Hono<{ Bindings: Env }>();

settingsRoutes.get("/", async (c) => {
  const s = (await kvGetJSON<Settings>(c.env, "settings", "current")) || {};
  return c.json({
    model: s.model || c.env.DARVIS_MODEL || "gpt-oss:120b-cloud",
    voice_id: s.voice_id || c.env.DARVIS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
    audio_mode: s.audio_mode || "classic",
  });
});

settingsRoutes.post("/", async (c) => {
  const body = await c.req.json<Settings>().catch(() => ({} as Settings));
  const current = (await kvGetJSON<Settings>(c.env, "settings", "current")) || {};
  if (body.model) current.model = body.model;
  if (body.voice_id) current.voice_id = body.voice_id;
  if (body.audio_mode) current.audio_mode = body.audio_mode;
  if (body.openrouter_model) current.openrouter_model = body.openrouter_model;
  await kvSetJSON(c.env, "settings", "current", current);
  return c.json(current);
});
