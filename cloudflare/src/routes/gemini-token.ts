import { Hono } from "hono";
import type { Env } from "../env";

export const geminiTokenRoute = new Hono<{ Bindings: Env }>();

geminiTokenRoute.get("/", async (c) => {
  const key = c.env.GEMINI_API_KEY;
  if (!key) return c.json({ error: "Gemini API key not configured" }, 503);

  // Try to mint an ephemeral token; fall back to returning the raw key
  // (still server-side, never shipped in frontend source).
  try {
    const now = new Date();
    const expireTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(now.getTime() + 2 * 60 * 1000).toISOString();

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1alpha/authTokens?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uses: 1, expireTime, newSessionExpireTime }),
      }
    );
    if (res.ok) {
      const data = (await res.json()) as { token?: string };
      if (data.token) {
        return c.json({ token: data.token, model: "gemini-2.5-flash-native-audio-latest" });
      }
    }
  } catch {
    // fall through
  }
  return c.json({ token: key, useAsKey: true, model: "gemini-2.5-flash-native-audio-latest" });
});
