import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const OLLAMA_KEY = Netlify.env.get("OLLAMA_API_KEY");
  const TAVILY_KEY = Netlify.env.get("TAVILY_API_KEY");
  const settingsStore = getStore("darvis-settings");
  const memoryStore = getStore("darvis-memory");
  const alertStore = getStore("darvis-alerts");
  const schedStore = getStore("darvis-scheduler");

  let MODEL = Netlify.env.get("DARVIS_MODEL") || "llama3.3:70b";
  try {
    const s = await settingsStore.get("current", { type: "json" });
    if (s?.model) MODEL = s.model;
  } catch {}

  const now = new Date();
  const hour = now.getHours();
  const period = hour < 6 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
  const timeStr = now.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "numeric", hour12: true });

  // Gather ALL context in parallel
  const [memResult, weatherResult, weatherDetail, globalNews, localNews, techNews, alertsResult, tasksResult] = await Promise.allSettled([
    // Memories + reminders
    memoryStore.get("all", { type: "json" }).catch(() => null),
    // Quick weather
    fetch("https://wttr.in/?format=%C+%t+%h+%w+%l", { headers: { "User-Agent": "curl" }, signal: AbortSignal.timeout(5000) }).then(r => r.text()).catch(() => ""),
    // Detailed weather forecast
    fetch("https://wttr.in/?format=%C+%t+%h+%w+%S+%s+feels+like+%f", { headers: { "User-Agent": "curl" }, signal: AbortSignal.timeout(5000) }).then(r => r.text()).catch(() => ""),
    // Global news (10 results, advanced depth)
    TAVILY_KEY ? fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_KEY, query: "top breaking news today world headlines", search_depth: "advanced", max_results: 10, include_answer: true }),
      signal: AbortSignal.timeout(15000),
    }).then(r => r.json()).catch(() => null) : Promise.resolve(null),
    // Local/US news
    TAVILY_KEY ? fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_KEY, query: "local news United States today top stories", search_depth: "advanced", max_results: 8, include_answer: true }),
      signal: AbortSignal.timeout(15000),
    }).then(r => r.json()).catch(() => null) : Promise.resolve(null),
    // Tech/science news
    TAVILY_KEY ? fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_KEY, query: "technology science news today", search_depth: "basic", max_results: 5, include_answer: true }),
      signal: AbortSignal.timeout(10000),
    }).then(r => r.json()).catch(() => null) : Promise.resolve(null),
    // Active alerts
    alertStore.get("all", { type: "json" }).catch(() => []),
    // Scheduled tasks
    schedStore.get("tasks", { type: "json" }).catch(() => []),
  ]);

  // Process memories
  let memoryCount = 0;
  let reminders = [];
  const mems = memResult.status === "fulfilled" ? memResult.value : null;
  if (Array.isArray(mems)) {
    memoryCount = mems.length;
    reminders = mems.filter(m => m.category === "reminder").map(m => m.content);
  } else if (mems?.memories) {
    memoryCount = mems.memories.length;
    reminders = mems.memories.filter(m => m.category === "reminder").map(m => m.content);
  }

  // Process weather
  const weather = weatherResult.status === "fulfilled" ? weatherResult.value.trim() : "";
  const weatherFull = weatherDetail.status === "fulfilled" ? weatherDetail.value.trim() : "";

  // Process news
  function formatNews(result, label) {
    if (!result || result.status !== "fulfilled" || !result.value) return "";
    const data = result.value;
    let text = `\n### ${label}:\n`;
    if (data.answer) text += `Summary: ${data.answer}\n`;
    if (data.results?.length) {
      data.results.forEach((r, i) => {
        text += `${i + 1}. **${r.title}** — ${r.content?.substring(0, 200) || ""}\n`;
      });
    }
    return text;
  }

  const globalNewsText = formatNews(globalNews, "Global Headlines");
  const localNewsText = formatNews(localNews, "Local / US News");
  const techNewsText = formatNews(techNews, "Tech & Science");

  // Process alerts and tasks
  const alerts = alertsResult.status === "fulfilled" && Array.isArray(alertsResult.value) ? alertsResult.value.filter(a => a.active) : [];
  const tasks = tasksResult.status === "fulfilled" && Array.isArray(tasksResult.value) ? tasksResult.value.filter(t => !t.completed) : [];

  const briefingPrompt = `You are delivering a comprehensive ${period} briefing. Do NOT say "Spectra" or your name. Here is ALL the data you have:

TIME: ${timeStr} (${period})

WEATHER: ${weather}
FORECAST DETAILS: ${weatherFull || "unavailable"}

${globalNewsText}
${localNewsText}
${techNewsText}

USER CONTEXT:
- ${memoryCount} saved memories
${reminders.length ? `- Active reminders: ${reminders.join("; ")}` : "- No reminders"}
- ${alerts.length} active monitoring alerts
- ${tasks.length} scheduled tasks${tasks.length ? ": " + tasks.slice(0, 3).map(t => t.task?.substring(0, 50)).join("; ") : ""}
- Platform: web browser

INSTRUCTIONS — Give a FULL, detailed JARVIS-style briefing:
1. ${period === "morning" ? "Good morning" : period === "evening" ? "Good evening" : "Greetings"} greeting with the time and date
2. Full weather report: current conditions, temperature, humidity, wind, what it feels like, sunrise/sunset if available
3. TOP GLOBAL NEWS: Cover at LEAST 5 major stories with 1-2 sentence summaries each. Don't just list headlines — actually explain what happened.
4. LOCAL/US NEWS: Cover at LEAST 3 stories with summaries.
5. TECH & SCIENCE: Cover 2-3 interesting stories.
6. Any reminders or scheduled tasks the user has.
7. Closing: witty sign-off, say you're standing by.

Be thorough. This is the user's primary news source. Do NOT skip stories or give one-liners. Give real substance — like a proper morning news anchor would, but with JARVIS personality. British wit, sardonic where appropriate, but informative above all. This should be a COMPREHENSIVE briefing, not a lazy summary.`;

  try {
    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "You are a dry-witted British AI assistant. NEVER say \"Spectra\" or your name. You deliver comprehensive, thorough briefings — professional, detailed, with a touch of sardonic humor. Never half-ass a briefing. The user depends on you for their news." },
          { role: "user", content: briefingPrompt },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) return Response.json({ briefing: "", headlines: "", weather });
    const data = await res.json();
    let text = data.message?.content || "";
    text = text.replace(/```command[\s\S]*?```/g, "").trim();
    return Response.json({ briefing: text, headlines: globalNewsText + localNewsText + techNewsText, weather });
  } catch {
    return Response.json({ briefing: "", headlines: "", weather: "" });
  }
};

export const config = { path: "/api/briefing" };
