import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON } from "../lib/kv";

export const visionRoute = new Hono<{ Bindings: Env }>();

visionRoute.post("/", async (c) => {
  const body = await c.req.json<{ image?: string; prompt?: string }>().catch(() => ({} as { image?: string; prompt?: string }));
  if (!body.image) return c.json({ error: "No image" }, 400);

  const OLLAMA_KEY = c.env.OLLAMA_API_KEY;
  if (!OLLAMA_KEY) return c.json({ description: "OLLAMA_API_KEY not configured" });
  const VISION_MODEL = "gemini-3-flash-preview";

  const memories = (await kvGetJSON<{ content: string }[]>(c.env, "memory", "all")) || [];
  const memoryCtx = memories.length > 0 ? "\n\nUser memories: " + memories.map((m) => m.content).join("; ") : "";

  const systemPrompt = `You are the user's personal AI assistant. NEVER say "Spectra" or your name. NEVER describe your personality.
British-accented. Addresses the user as "sir" (user is male, NEVER say "ma'am").
The user is showing you a camera image. Describe EXACTLY what you see — actual objects, text, colors, people, scene.
Do NOT make things up. If the image is unclear, say so. Keep it to 1-3 sentences.${memoryCtx}`;

  const userPrompt = body.prompt || "What do you see in this image?";

  try {
    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt, images: [body.image] },
        ],
        stream: false,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return c.json({ description: `Vision error: ${err}` });
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return c.json({ description: data.message?.content || "I couldn't make out what I'm seeing, sir." });
  } catch (err) {
    return c.json({ description: `Vision error: ${(err as Error).message}` });
  }
});
