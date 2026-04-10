import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { image, prompt } = await req.json();
  if (!image) {
    return Response.json({ error: "No image" }, { status: 400 });
  }

  const OLLAMA_KEY = Netlify.env.get("OLLAMA_API_KEY");
  const VISION_MODEL = "gemini-3-flash-preview"; // Supports images on Ollama Cloud

  // Load memory for context
  const memoryStore = getStore("darvis-memory");
  let memoryCtx = "";
  try {
    const memories = await memoryStore.get("all", { type: "json" });
    if (Array.isArray(memories) && memories.length > 0) {
      memoryCtx =
        "\n\nUser memories: " +
        memories.map((m) => m.content).join("; ");
    }
  } catch {}

  const systemPrompt = `You are S.P.E.C.T.R.A., a Digital Assistant, Rather Very Intelligent System.
Dry-witted, efficient, British-accented. Addresses the user as "sir" or "ma'am".
The user is showing you a camera image. Describe EXACTLY what you see — actual objects, text, colors, people, scene.
Do NOT make things up. If the image is unclear, say so. Keep it to 1-3 sentences.${memoryCtx}`;

  const userPrompt = prompt || "What do you see in this image?";

  try {
    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OLLAMA_KEY}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt, images: [image] },
        ],
        stream: false,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ description: `Vision error: ${err}` });
    }

    const data = await res.json();
    const description =
      data.message?.content || "I couldn't make out what I'm seeing, sir.";
    return Response.json({ description });
  } catch (err) {
    return Response.json({ description: `Vision error: ${err.message}` });
  }
};

export const config = { path: "/api/vision" };
