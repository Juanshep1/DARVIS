import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const OLLAMA_KEY = Netlify.env.get("OLLAMA_API_KEY");
  const settingsStore = getStore("darvis-settings");
  const memoryStore = getStore("darvis-memory");

  let MODEL = Netlify.env.get("DARVIS_MODEL") || "llama3.3:70b";
  try {
    const s = await settingsStore.get("current", { type: "json" });
    if (s?.model) MODEL = s.model;
  } catch {}

  // Gather context
  const now = new Date();
  const hour = now.getHours();
  const timeOfDay = hour < 6 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
  const timeStr = now.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "numeric", hour12: true });

  let memoryCount = 0;
  try {
    const mems = await memoryStore.get("all", { type: "json" });
    if (Array.isArray(mems)) memoryCount = mems.length;
  } catch {}

  // Get weather
  let weather = "";
  try {
    const wRes = await fetch("https://wttr.in/?format=3", { headers: { "User-Agent": "curl" } });
    if (wRes.ok) weather = (await wRes.text()).trim();
  } catch {}

  const briefingPrompt = `Give a brief JARVIS-style startup greeting. Context:
- Time: ${timeStr} (${timeOfDay})
- Weather: ${weather || "unknown"}
- User has ${memoryCount} saved memories
- Platform: web browser

Be like JARVIS from Iron Man — concise, witty, informative. 2 sentences max.
Include time greeting and one weather/observation note. Be natural.`;

  try {
    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "You are DARVIS, a dry-witted British AI assistant." },
          { role: "user", content: briefingPrompt },
        ],
        stream: false,
      }),
    });

    if (!res.ok) return Response.json({ briefing: "" });
    const data = await res.json();
    let text = data.message?.content || "";
    text = text.replace(/```command[\s\S]*?```/g, "").trim();
    return Response.json({ briefing: text });
  } catch {
    return Response.json({ briefing: "" });
  }
};

export const config = { path: "/api/briefing" };
