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
  const period = hour < 6 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
  const timeStr = now.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "numeric", hour12: true });

  let memoryCount = 0;
  let reminders = [];
  try {
    const mems = await memoryStore.get("all", { type: "json" });
    if (Array.isArray(mems)) {
      memoryCount = mems.length;
      reminders = mems.filter(m => m.category === "reminder").map(m => m.content);
    }
  } catch {}

  // Weather
  let weather = "";
  try {
    const wRes = await fetch("https://wttr.in/?format=%C+%t+%h+%w", { headers: { "User-Agent": "curl" } });
    if (wRes.ok) weather = (await wRes.text()).trim();
  } catch {}

  // Headlines
  let headlines = "";
  try {
    const TAVILY_KEY = Netlify.env.get("TAVILY_API_KEY");
    if (TAVILY_KEY) {
      const tRes = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: TAVILY_KEY, query: "top news today", search_depth: "basic", max_results: 5, include_answer: true }),
      });
      if (tRes.ok) {
        const tData = await tRes.json();
        if (tData.results?.length) {
          headlines = tData.results.map((r, i) => `${i + 1}. ${r.title}`).join("\n");
        }
      }
    }
  } catch {}

  const briefingPrompt = `You just started up. Here's what's happening:
- Time: ${timeStr} (${period})
- Weather: ${weather || "unavailable"}
- User has ${memoryCount} saved memories
${reminders.length ? `- Reminders: ${reminders.join(", ")}` : ""}
- Top headlines:
${headlines || "(unavailable)"}
- Platform: web browser (darvis1.netlify.app)

Give a JARVIS-style spoken briefing:
1. Time-appropriate greeting
2. Weather in one phrase
3. Mention 1-2 interesting headlines briefly
4. Note any reminders
5. Say you're ready to assist

3-4 sentences. Witty, British, concise. No command blocks.`;

  try {
    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "You are DARVIS, a dry-witted British AI assistant like JARVIS from Iron Man." },
          { role: "user", content: briefingPrompt },
        ],
        stream: false,
      }),
    });

    if (!res.ok) return Response.json({ briefing: "", headlines: "" });
    const data = await res.json();
    let text = data.message?.content || "";
    text = text.replace(/```command[\s\S]*?```/g, "").trim();
    return Response.json({ briefing: text, headlines, weather });
  } catch {
    return Response.json({ briefing: "", headlines: "", weather: "" });
  }
};

export const config = { path: "/api/briefing" };
