import { getStore } from "@netlify/blobs";

const CLOUD_MODELS = [
  "llama3.3:70b", "llama3.1:8b", "qwen2.5:72b", "qwen2.5:7b",
  "deepseek-r1:70b", "deepseek-r1:8b", "mistral:7b", "gemma2:27b",
  "phi4:14b", "glm-5",
];

export default async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const store = getStore("darvis-settings");
  let current = Netlify.env.get("DARVIS_MODEL") || "llama3.3:70b";
  try {
    const data = await store.get("current", { type: "json" });
    if (data?.model) current = data.model;
  } catch {}

  return Response.json({ models: CLOUD_MODELS, current });
};

export const config = { path: "/api/models" };
