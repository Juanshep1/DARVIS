import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON } from "../lib/kv";

export const briefingRoute = new Hono<{ Bindings: Env }>();

briefingRoute.get("/", async (c) => {
  const OLLAMA_KEY = c.env.OLLAMA_API_KEY;
  const TAVILY_KEY = c.env.TAVILY_API_KEY;
  const settings = await kvGetJSON<{ model?: string }>(c.env, "settings", "current");
  const MODEL = settings?.model || c.env.DARVIS_MODEL || "gpt-oss:120b-cloud";

  const now = new Date();
  const hour = now.getHours();
  const period = hour < 6 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
  const timeStr = now.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "numeric", hour12: true });

  const tavilyFetch = (query: string, maxResults: number, depth: "advanced" | "basic" = "advanced") =>
    TAVILY_KEY
      ? fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: TAVILY_KEY, query, search_depth: depth, max_results: maxResults, include_answer: true }),
          signal: AbortSignal.timeout(15000),
        }).then((r) => r.json()).catch(() => null)
      : Promise.resolve(null);

  const [memResult, weatherResult, weatherDetail, globalNews, localNews, techNews, alertsResult, tasksResult] = await Promise.allSettled([
    kvGetJSON<{ content?: string; category?: string }[]>(c.env, "memory", "all"),
    fetch("https://wttr.in/?format=%C+%t+%h+%w+%l", { headers: { "User-Agent": "curl" }, signal: AbortSignal.timeout(5000) }).then((r) => r.text()).catch(() => ""),
    fetch("https://wttr.in/?format=%C+%t+%h+%w+%S+%s+feels+like+%f", { headers: { "User-Agent": "curl" }, signal: AbortSignal.timeout(5000) }).then((r) => r.text()).catch(() => ""),
    tavilyFetch("top breaking news today world headlines", 10),
    tavilyFetch("local news United States today top stories", 8),
    tavilyFetch("technology science news today", 5, "basic"),
    kvGetJSON<{ active?: boolean }[]>(c.env, "alerts", "all"),
    kvGetJSON<{ completed?: boolean; task?: string }[]>(c.env, "scheduler", "tasks"),
  ]);

  let memoryCount = 0;
  let reminders: string[] = [];
  const mems = memResult.status === "fulfilled" ? memResult.value : null;
  if (Array.isArray(mems)) {
    memoryCount = mems.length;
    reminders = mems.filter((m) => m.category === "reminder").map((m) => m.content || "");
  }

  const weather = weatherResult.status === "fulfilled" ? (weatherResult.value || "").trim() : "";
  const weatherFull = weatherDetail.status === "fulfilled" ? (weatherDetail.value || "").trim() : "";

  const formatNews = (result: PromiseSettledResult<unknown>, label: string): string => {
    if (result.status !== "fulfilled" || !result.value) return "";
    const data = result.value as { answer?: string; results?: { title?: string; content?: string }[] };
    let text = `\n### ${label}:\n`;
    if (data.answer) text += `Summary: ${data.answer}\n`;
    if (data.results?.length) {
      data.results.forEach((r, i) => {
        text += `${i + 1}. **${r.title}** — ${r.content?.substring(0, 200) || ""}\n`;
      });
    }
    return text;
  };

  const globalNewsText = formatNews(globalNews, "Global Headlines");
  const localNewsText = formatNews(localNews, "Local / US News");
  const techNewsText = formatNews(techNews, "Tech & Science");

  const alerts = alertsResult.status === "fulfilled" && Array.isArray(alertsResult.value) ? alertsResult.value.filter((a) => a.active) : [];
  const tasks = tasksResult.status === "fulfilled" && Array.isArray(tasksResult.value) ? tasksResult.value.filter((t) => !t.completed) : [];

  const briefingPrompt = `You are delivering a comprehensive ${period} briefing. Do NOT say "Spectra". Here is ALL the data:

TIME: ${timeStr} (${period})
WEATHER: ${weather}
FORECAST: ${weatherFull || "unavailable"}

${globalNewsText}
${localNewsText}
${techNewsText}

USER CONTEXT:
- ${memoryCount} saved memories
${reminders.length ? `- Active reminders: ${reminders.join("; ")}` : "- No reminders"}
- ${alerts.length} active monitoring alerts
- ${tasks.length} scheduled tasks${tasks.length ? ": " + tasks.slice(0, 3).map((t) => (t.task || "").substring(0, 50)).join("; ") : ""}

INSTRUCTIONS — FULL, detailed JARVIS-style briefing:
1. ${period === "morning" ? "Good morning" : period === "evening" ? "Good evening" : "Greetings"} greeting with time/date
2. Full weather report
3. TOP GLOBAL NEWS: at least 5 stories with 1-2 sentence summaries each
4. LOCAL/US NEWS: at least 3 stories with summaries
5. TECH & SCIENCE: 2-3 interesting stories
6. Reminders and scheduled tasks
7. Witty sign-off

Be thorough. British wit, sardonic where appropriate, informative above all.`;

  if (!OLLAMA_KEY) return c.json({ briefing: "", headlines: "", weather });

  try {
    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "You are the user's personal AI assistant. NEVER say \"Spectra\". NEVER describe your personality. Comprehensive, thorough briefings with subtle British wit." },
          { role: "user", content: briefingPrompt },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return c.json({ briefing: "", headlines: "", weather });
    const data = (await res.json()) as { message?: { content?: string } };
    let text = data.message?.content || "";
    text = text.replace(/```command[\s\S]*?```/g, "").trim();
    return c.json({ briefing: text, headlines: globalNewsText + localNewsText + techNewsText, weather });
  } catch {
    return c.json({ briefing: "", headlines: "", weather: "" });
  }
});
