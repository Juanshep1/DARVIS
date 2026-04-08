import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const OLLAMA_KEY = Netlify.env.get("OLLAMA_API_KEY");
  const store = getStore("darvis-settings");

  let current = Netlify.env.get("DARVIS_MODEL") || "glm-5";
  try {
    const data = await store.get("current", { type: "json" });
    if (data?.model) current = data.model;
  } catch {}

  // Fetch live models from Ollama Cloud
  let models = [];
  try {
    const res = await fetch("https://ollama.com/api/tags", {
      headers: { Authorization: `Bearer ${OLLAMA_KEY}` },
    });
    if (res.ok) {
      const data = await res.json();
      models = (data.models || []).map((m) => m.name).sort();
    }
  } catch {}

  // Fallback if fetch fails
  if (models.length === 0) {
    models = [
      "cogito-2.1:671b", "deepseek-v3.1:671b", "deepseek-v3.2",
      "devstral-2:123b", "gemini-3-flash-preview",
      "gemma3:4b", "gemma3:12b", "gemma3:27b", "gemma4:31b",
      "glm-5", "glm-5.1", "glm-4.7",
      "gpt-oss:120b", "kimi-k2.5", "kimi-k2:1t",
      "minimax-m2.7", "ministral-3:8b",
      "mistral-large-3:675b", "nemotron-3-super",
      "qwen3.5:397b", "qwen3-vl:235b", "qwen3-coder:480b",
    ];
  }

  return Response.json({ models, current });
};

export const config = { path: "/api/models" };
