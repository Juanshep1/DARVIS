import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON } from "../lib/kv";

export const modelsRoute = new Hono<{ Bindings: Env }>();

modelsRoute.get("/", async (c) => {
  const settings = await kvGetJSON<{ model?: string }>(c.env, "settings", "current");
  let current = settings?.model || c.env.DARVIS_MODEL || "gpt-oss:120b-cloud";

  let models: string[] = [];
  if (c.env.OLLAMA_API_KEY) {
    try {
      const res = await fetch("https://ollama.com/api/tags", {
        headers: { Authorization: `Bearer ${c.env.OLLAMA_API_KEY}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { models?: { name?: string }[] };
        models = (data.models || []).map((m) => m.name || "").filter(Boolean).sort();
      }
    } catch {}
  }
  if (models.length === 0) {
    models = [
      "gpt-oss:120b-cloud", "gpt-oss:20b-cloud",
      "qwen3-coder:480b-cloud", "qwen3-vl:235b-cloud",
      "deepseek-v3.1:671b-cloud", "glm-4.6:cloud",
      "gemma3:27b", "gemma3:12b", "gemma3:4b",
    ];
  }
  const localModels = ["nimble-athena-unclothed", "nimble-athena", "nimble-aries-big", "nimble-aries", "nimble"];
  const allModels = [...localModels.map((m) => `local:${m}`), ...models];
  return c.json({ models: allModels, current });
});
