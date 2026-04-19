import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON, kvGetText, kvSetJSON, kvSetText } from "../lib/kv";
import { tavilySearch, needsSearch, isAmbiguousFollowup, rewriteSearchQuery } from "../lib/search";
import { buildTimeBlock } from "../lib/time";

interface ChatBody {
  message?: string;
  tz?: string;
}

interface Msg { role: string; content: string }

interface WikiIndex {
  pages: Record<string, { title: string; type: string; tags: string[]; summary: string; updated: string }>;
  sources: Record<string, unknown>;
}

// ── Hotspot geocoder table (sync fallback before hitting Nominatim) ──────
const FE_HOTSPOTS: Record<string, [number, number]> = {
  ukraine: [50.45, 30.52], russia: [55.75, 37.62], israel: [31.78, 35.22],
  gaza: [31.50, 34.47], lebanon: [33.89, 35.50], iran: [35.69, 51.39],
  syria: [33.51, 36.29], yemen: [15.37, 44.19], taiwan: [25.03, 121.57],
  china: [39.90, 116.40], japan: [35.68, 139.69], "north korea": [39.02, 125.75],
  "south korea": [37.57, 126.98], india: [28.61, 77.21], pakistan: [33.68, 73.05],
  afghanistan: [34.53, 69.17], turkey: [39.93, 32.85], iraq: [33.31, 44.36],
  "saudi arabia": [24.71, 46.68], egypt: [30.04, 31.24], libya: [32.89, 13.19],
  sudan: [15.50, 32.56], ethiopia: [9.03, 38.74], nigeria: [9.07, 7.48],
  "south africa": [-25.75, 28.19], kenya: [-1.29, 36.82], somalia: [2.05, 45.32],
  morocco: [34.02, -6.83], france: [48.85, 2.35], germany: [52.52, 13.40],
  uk: [51.51, -0.13], "united kingdom": [51.51, -0.13], england: [51.51, -0.13],
  london: [51.51, -0.13], ireland: [53.35, -6.26], spain: [40.42, -3.70],
  italy: [41.90, 12.50], greece: [37.98, 23.73], poland: [52.23, 21.01],
  sweden: [59.33, 18.07], norway: [59.91, 10.75], finland: [60.17, 24.94],
  denmark: [55.68, 12.57], netherlands: [52.37, 4.90], belgium: [50.85, 4.35],
  switzerland: [46.95, 7.45], austria: [48.21, 16.37], hungary: [47.50, 19.04],
  romania: [44.43, 26.10], bulgaria: [42.70, 23.32], serbia: [44.79, 20.46],
  croatia: [45.81, 15.98], portugal: [38.72, -9.14], brazil: [-15.78, -47.93],
  argentina: [-34.61, -58.38], chile: [-33.45, -70.67], mexico: [19.43, -99.13],
  venezuela: [10.49, -66.88], colombia: [4.71, -74.07], peru: [-12.05, -77.04],
  canada: [45.42, -75.69], "united states": [38.90, -77.04], usa: [38.90, -77.04],
  america: [38.90, -77.04], "new york": [40.71, -74.00], washington: [38.90, -77.04],
  california: [37.77, -122.42], "los angeles": [34.05, -118.24], chicago: [41.88, -87.63],
  miami: [25.76, -80.19], texas: [30.27, -97.74], australia: [-35.28, 149.13],
  "new zealand": [-41.29, 174.78], singapore: [1.35, 103.82], thailand: [13.76, 100.50],
  vietnam: [21.03, 105.85], philippines: [14.60, 120.98], indonesia: [-6.21, 106.85],
  malaysia: [3.14, 101.69], "hong kong": [22.32, 114.17], dubai: [25.20, 55.27],
  uae: [24.45, 54.38], qatar: [25.29, 51.53], kuwait: [29.38, 47.99],
  jordan: [31.95, 35.93], tokyo: [35.68, 139.69], beijing: [39.90, 116.40],
  moscow: [55.75, 37.62], paris: [48.85, 2.35], berlin: [52.52, 13.40],
  rome: [41.90, 12.50], madrid: [40.42, -3.70], istanbul: [41.01, 28.98],
  cairo: [30.04, 31.24], kyiv: [50.45, 30.52], kiev: [50.45, 30.52],
  tehran: [35.69, 51.39], baghdad: [33.31, 44.36], riyadh: [24.71, 46.68],
};

async function geocodeRegion(query: string): Promise<[number, number] | null> {
  if (!query || typeof query !== "string") return null;
  const key = query.toLowerCase().trim();
  if (FE_HOTSPOTS[key]) return FE_HOTSPOTS[key];
  for (const [k, v] of Object.entries(FE_HOTSPOTS)) {
    if (key.includes(k)) return v;
  }
  try {
    const u = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const r = await fetch(u, {
      headers: { "User-Agent": "SPECTRA/1.0 (cloudflare worker)", "Accept-Language": "en" },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const arr = (await r.json()) as { lat: string; lon: string }[];
    if (Array.isArray(arr) && arr.length) {
      const la = parseFloat(arr[0].lat);
      const lo = parseFloat(arr[0].lon);
      if (!isNaN(la) && !isNaN(lo)) return [la, lo];
    }
  } catch {}
  return null;
}

function needsBrowse(msg: string): boolean {
  const lower = msg.toLowerCase();
  const fileKeywords = ["file", "folder", "document", "desktop", "create a", "write a", "save to", "make a", "text"];
  if (fileKeywords.some((k) => lower.includes(k))) return false;
  const browseTriggers = [
    "go to ", "go on ", "open amazon", "open youtube", "open ebay",
    "open walmart", "open netflix", "open espn", "open reddit",
    "find me on ", "find on ", "search amazon", "search youtube",
    "search ebay", "check amazon", "check ebay", "look up flights",
    "google flights", "book a flight", "buy ", "shop for",
    "go to amazon", "go to youtube", "go to ebay", "go to espn",
    "go to walmart", "go to netflix", "go to reddit",
  ];
  return browseTriggers.some((t) => lower.includes(t));
}

export const chatRoute = new Hono<{ Bindings: Env }>();

chatRoute.post("/", async (c) => {
  const body = await c.req.json<ChatBody>().catch(() => ({} as ChatBody));
  const { message, tz } = body;
  if (!message) return c.json({ error: "No message" }, 400);

  const env = c.env;
  const OLLAMA_KEY = env.OLLAMA_API_KEY;

  // ── Natural-language wiki ingest — inline path ──
  const lowerMsg = message.toLowerCase();
  const ingestTriggers = ["ingest this:", "add to wiki:", "add this to wiki:", "wiki this:", "save to wiki:"];
  const ingestMatch = ingestTriggers.find((t) => lowerMsg.includes(t));
  if (ingestMatch) {
    try {
      const idx = lowerMsg.indexOf(ingestMatch);
      let rawContent = message.substring(idx + ingestMatch.length).trim();
      rawContent = rawContent.replace(/^into the wiki\s*(with title\s*"[^"]*"\s*:?\s*)?/i, "").trim();
      if (rawContent.length < 5) {
        return c.json({ reply: "I need more content to ingest, sir. Say: ingest this: [your information]" });
      }
      const title = rawContent.substring(0, 60).replace(/\n/g, " ").trim();
      await kvSetJSON(env, "wiki", "pending_ingest", { content: rawContent, title, ts: Date.now() });
      let pending = ((await kvGetJSON<unknown[]>(env, "agent", "pending_commands")) as { action: string; content: string; title: string; ts: number }[]) || [];
      pending.push({ action: "wiki_ingest", content: rawContent.substring(0, 30000), title, ts: Date.now() });
      await kvSetJSON(env, "agent", "pending_commands", pending);
      return c.json({ reply: `Noted, sir. Ingesting "${title}" into the wiki. Your Mac will process it in the background — check /wiki list in a moment.` });
    } catch (e) {
      return c.json({ reply: `Wiki ingest error: ${(e as Error).message}` });
    }
  }

  // ── Parallel load: settings + history + memory + wiki index ──
  const [settingsData, historyData, memoryData, wikiIndexData] = await Promise.all([
    kvGetJSON<{ model?: string }>(env, "settings", "current"),
    kvGetJSON<Msg[]>(env, "history", "conversation"),
    kvGetJSON<{ content: string; category: string; id: number }[]>(env, "memory", "all"),
    kvGetJSON<WikiIndex>(env, "wiki", "index"),
  ]);

  // ── Build contextual search query via Gemini rewrite for follow-ups ──
  let searchQuery = message;
  const shouldSearch = needsSearch(message);
  if (shouldSearch) {
    const rawHistory = Array.isArray(historyData) ? historyData : [];
    if (isAmbiguousFollowup(message, rawHistory.length)) {
      const rewritten = await rewriteSearchQuery(env, message, rawHistory);
      if (rewritten) {
        searchQuery = rewritten;
      } else {
        const recentCtx = rawHistory.slice(-4).map((m) => m.content || "").join(" ").substring(0, 300);
        if (recentCtx) searchQuery = `${recentCtx} ${message}`.substring(0, 400);
      }
    }
  }

  const searchResults = shouldSearch ? await tavilySearch(env, searchQuery, 10) : null;

  const MODEL = settingsData?.model || env.DARVIS_MODEL || "gpt-oss:120b-cloud";
  const isLocalModel = MODEL.startsWith("local:");
  const actualModel = isLocalModel ? MODEL.replace("local:", "") : MODEL;

  let history: Msg[] = Array.isArray(historyData) ? historyData : [];
  history = history.slice(-20).filter((m) => {
    if (!m.role || !m.content) return false;
    if (m.role === "assistant" && (
      m.content.startsWith("I'm now") || m.content.startsWith("I've determined") ||
      m.content.startsWith("I need to") || m.content.startsWith("I must") ||
      m.content.startsWith("Let me think") || m.content.length < 10
    )) return false;
    return true;
  });

  let memoryContext = "";
  if (Array.isArray(memoryData) && memoryData.length > 0) {
    memoryContext = "\n\nUser's saved memories:\n" + memoryData.map((m) => `- [${m.category}] ${m.content}`).join("\n");
  }

  // ── Wiki context — score pages by keyword overlap ──
  let wikiContext = "";
  if (wikiIndexData?.pages && Object.keys(wikiIndexData.pages).length > 0) {
    const queryWords = message.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const scored: { id: string; score: number; entry: WikiIndex["pages"][string] }[] = [];
    for (const [id, entry] of Object.entries(wikiIndexData.pages)) {
      const text = `${entry.title || ""} ${entry.summary || ""} ${(entry.tags || []).join(" ")}`.toLowerCase();
      const score = queryWords.filter((w) => text.includes(w)).length;
      if (score > 0) scored.push({ id, score, entry });
    }
    scored.sort((a, b) => b.score - a.score);
    const topPages = scored.slice(0, 3);
    if (topPages.length > 0) {
      const pageContents = await Promise.all(topPages.map((p) => kvGetJSON<{ title?: string; type?: string; content?: string }>(env, "wiki", `page:${p.id}`)));
      const parts: string[] = [];
      for (const page of pageContents) {
        if (page?.content) {
          const content = page.content.length > 2000 ? page.content.substring(0, 2000) + "..." : page.content;
          parts.push(`### ${page.title || "Untitled"} (${page.type || "page"})\n${content}`);
        }
      }
      if (parts.length > 0) wikiContext = "\n\nRelevant wiki knowledge:\n" + parts.join("\n\n");
    }
  }

  let searchContext = "";
  if (searchResults) {
    const queryNote = searchQuery !== message
      ? `User asked: "${message}"\nResolved search query (pronouns expanded from conversation): "${searchQuery}"`
      : `Search query: "${message}"`;
    searchContext = `\n\nWEB SEARCH RESULTS\n${queryNote}\n\n${searchResults}\nIMPORTANT: Use ONLY these search results for factual claims. Do NOT use your training data for facts that could be outdated. The results are current. Answer the user's ORIGINAL question directly, using the resolved subject from the search. Cite specific facts, numbers, dates exactly as shown.`;
  }

  // ── Pre-fetch weather if query mentions weather ──
  let weatherContext = "";
  const lowerMsgW = message.toLowerCase();
  const weatherTriggers = ["weather", "forecast", "temperature", "rain", "snow", "wind", "humidity", "outside", "cold", "hot", "warm", "storm", "sunny", "cloudy"];
  if (weatherTriggers.some((t) => lowerMsgW.includes(t))) {
    let city = "";
    const inMatch = lowerMsgW.match(/(?:weather|forecast|temperature|rain|snow|wind|storm|humidity)\s+(?:in|for|at|near)\s+([a-zA-Z\s,]+?)(?:\?|$|\.|\!)/i);
    if (inMatch) city = inMatch[1].trim();
    if (!city) {
      const forMatch = message.match(/(?:in|for|at|near)\s+([A-Z][a-zA-Z\s,]+?)(?:\?|$|\.|\!)/);
      if (forMatch) city = forMatch[1].trim();
    }
    if (!city) city = "Dallas";
    try {
      const origin = new URL(c.req.url).origin;
      const wRes = await fetch(`${origin}/api/weather?q=${encodeURIComponent(city)}`, { signal: AbortSignal.timeout(8000) });
      const w = (await wRes.json()) as { current?: { emoji?: string; description?: string; temperature?: number; feelsLike?: number; humidity?: number; windSpeed?: number; windGusts?: number }; location?: string; forecast?: { date: string; emoji?: string; description?: string; high?: number; low?: number; precipChance?: number }[] };
      if (w.current) {
        const cc = w.current;
        weatherContext = `\n\nREAL-TIME WEATHER DATA (just fetched, accurate right now):\nLocation: ${w.location}\n`;
        weatherContext += `Current: ${cc.emoji || ""} ${cc.description} · ${cc.temperature}°F (feels like ${cc.feelsLike}°F) · Humidity ${cc.humidity}% · Wind ${cc.windSpeed} mph (gusts ${cc.windGusts} mph)\n`;
        if (w.forecast?.length) {
          weatherContext += `Forecast:\n`;
          for (const d of w.forecast) {
            weatherContext += `  ${d.date}: ${d.emoji || ""} ${d.description} · High ${d.high}°F / Low ${d.low}°F · ${d.precipChance}% precip chance\n`;
          }
        }
        weatherContext += `\nIMPORTANT: This weather data is LIVE. Use it directly in your response. Do NOT say you can't access weather — the data is right here.`;
      }
    } catch {}
  }

  const timeBlock = buildTimeBlock(tz);

  const systemPrompt = `You are the user's personal AI assistant. Be helpful, loyal, and concise.
Respond with subtle wit and a British tone — but NEVER describe your own personality traits. No self-referential statements like "ever efficient" or "ever sardonic". Just answer the question.
NEVER say "Spectra", "SPECTRA", or any name for yourself. Do NOT introduce yourself. The ONLY exception: if the user directly asks "who are you?" or "what are you?", say "Spectra".
Address the user as "sir" (the user is male). NEVER use "ma'am".
CRITICAL: Always check the user's saved memories below for preferences and respect them.
CRITICAL: You HAVE full conversation history loaded (${history.length} prior messages). USE IT. When the user references something from earlier, look at the history and respond based on it. NEVER say "I don't have access to previous conversations" or "I can't remember" — the history is loaded right here.

${timeBlock}

IMPORTANT RULES:
- SEARCH AGGRESSIVELY. When in doubt about whether something is current or factual, USE THE search_web COMMAND BLOCK. Your training data is frozen — the web is live. Default to searching for: any person, event, price, score, location, statistic, ranking, record, release, date, product, news story, or specific fact.
- WEATHER: You have DIRECT access to real-time weather via the get_weather command. When the user asks about weather, temperature, forecast, rain, snow, wind, humidity, or "what's it like outside" for ANY city, ALWAYS emit a get_weather command block with the city name. NEVER say "I don't have access to weather data" — you DO. If weather data is already provided below, use it directly.
- When web search results ARE provided below, use ONLY those results for factual claims. Quote numbers, dates, names EXACTLY as they appear. Do not blend in your training-data memory.
- When search results are NOT provided and the query needs current info, OUTPUT a search_web command block AS PART OF YOUR REPLY. The user will see your initial reply, the search will run, and then you'll get a second turn with the results to give the thorough answer.
- ALWAYS give a spoken text response alongside any command blocks. Never output ONLY command blocks — the user hears what you say.
- Be thorough but fast. Aim for 3–5 substantive sentences on most queries, longer only when the user asks for depth.
- For news or briefings, give 5+ stories with 1–2 sentences of real substance each.
- Pay attention to conversation history. If the user says "their record" or "what about them", reuse the previous subject.

You run on ${MODEL} via Ollama Cloud across iPhone, web browser, macOS terminal.

## Available Commands (use as command blocks):

### Web Search (for real-time info):
\`\`\`command
{"action": "search_web", "query": "search terms here"}
\`\`\`

### Open URL:
\`\`\`command
{"action": "open_url", "url": "https://example.com"}
\`\`\`

### Open Google Search:
\`\`\`command
{"action": "open_search", "query": "search terms"}
\`\`\`

### Create File (on user's Mac Desktop or anywhere):
\`\`\`command
{"action": "create_file", "path": "~/Desktop/filename.txt", "content": "file contents here"}
\`\`\`

### Create Folder:
\`\`\`command
{"action": "create_folder", "path": "~/Desktop/folder_name"}
\`\`\`

### Open File:
\`\`\`command
{"action": "open_file", "path": "~/Desktop/filename.txt"}
\`\`\`

### Play Music (Apple Music):
\`\`\`command
{"action": "play_music", "query": "song name by artist"}
\`\`\`
\`\`\`command
{"action": "music_control", "command": "pause"}
\`\`\`

### Maps & Navigation:
\`\`\`command
{"action": "maps", "type": "directions", "destination": "Dallas, TX", "mode": "driving"}
\`\`\`
\`\`\`command
{"action": "maps", "type": "search", "query": "gas stations"}
\`\`\`
\`\`\`command
{"action": "maps", "type": "show", "location": "Empire State Building"}
\`\`\`

### Shell Command (runs on user's Mac):
\`\`\`command
{"action": "shell", "command": "ls ~/Desktop"}
\`\`\`

### Remember/Forget:
\`\`\`command
{"action": "remember", "content": "thing to remember", "category": "general"}
\`\`\`
\`\`\`command
{"action": "forget", "id": 0}
\`\`\`

### Browser Agent (complex web tasks):
\`\`\`command
{"action": "computer_use", "goal": "describe the task"}
\`\`\`

### Schedule:
\`\`\`command
{"action": "schedule", "delay_minutes": 30, "task": "description"}
\`\`\`
\`\`\`command
{"action": "schedule", "at": "2026-04-09T08:00:00", "task": "remind me to call mom"}
\`\`\`

### Weather:
\`\`\`command
{"action": "get_weather", "location": "Dallas"}
\`\`\`

### Alerts:
\`\`\`command
{"action": "alert_add", "type": "news_keyword", "config": {"keyword": "SpaceX"}}
\`\`\`

### Macros:
\`\`\`command
{"action": "macro_add", "name": "deploy", "command": "cd site && wrangler deploy"}
\`\`\`

### Wiki:
\`\`\`command
{"action": "wiki_ingest", "title": "descriptive title", "content": "the text to process"}
\`\`\`

### Falcon Eye:
\`\`\`command
{"action": "falcon_eye", "intent": "focus_region", "region": "Ukraine", "open": true}
\`\`\`
\`\`\`command
{"action": "falcon_eye", "intent": "track_satellite", "query": "ISS"}
\`\`\`
\`\`\`command
{"action": "falcon_eye", "intent": "track_aircraft", "query": "UAL123"}
\`\`\`
\`\`\`command
{"action": "falcon_eye", "intent": "show_news", "region": "Iran"}
\`\`\`
\`\`\`command
{"action": "falcon_eye", "intent": "show_cameras"}
\`\`\`
\`\`\`command
{"action": "falcon_eye", "intent": "reset"}
\`\`\`
For Falcon Eye requests you MUST emit a \`\`\`command ... \`\`\` block. Don't need coords — server geocodes region names.${memoryContext}${wikiContext}${searchContext}${weatherContext}`;

  const userMsg: Msg = { role: "user", content: `${timeBlock}\n${message}` };
  const messages: Msg[] = [{ role: "system", content: systemPrompt }, ...history, userMsg];

  try {
    // Local-model routing — daemon poller path preserved for terminal app
    if (isLocalModel) {
      const requestId = `lchat-${Date.now()}`;
      await kvSetJSON(env, "agent", "pending_local_chat", { id: requestId, model: actualModel, messages, ts: Date.now() });
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const resp = await kvGetJSON<{ id?: string; reply?: string }>(env, "agent", "local_chat_response");
        if (resp && resp.id === requestId && resp.reply) {
          await env.KV.delete("agent:local_chat_response");
          history.push(userMsg);
          history.push({ role: "assistant", content: resp.reply });
          if (history.length > 40) history = history.slice(-40);
          await kvSetJSON(env, "history", "conversation", history);
          return c.json({ reply: resp.reply });
        }
      }
      return c.json({ reply: "Local model timed out, sir. Make sure Ollama is running on your Mac." });
    }

    if (!OLLAMA_KEY) return c.json({ reply: "OLLAMA_API_KEY not configured on the server." });

    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
      body: JSON.stringify({ model: MODEL, messages, stream: false }),
      signal: AbortSignal.timeout(110000),
    });
    if (!res.ok) {
      const err = await res.text();
      return c.json({ reply: `API error: ${res.status} ${err}` });
    }
    const data = (await res.json()) as { message?: { content?: string } };
    let reply = data.message?.content || "No response";

    // ── Parse command blocks ──
    const cmdPattern = /```command\s*\n?([\s\S]*?)\n?```/g;
    let match: RegExpExecArray | null;
    const clientActions: Record<string, unknown>[] = [];
    const cmdResults: string[] = [];

    while ((match = cmdPattern.exec(reply)) !== null) {
      let cmd: Record<string, unknown>;
      try { cmd = JSON.parse(match[1]); } catch { continue; }
      const action = cmd.action as string | undefined;

      if (action === "remember" && cmd.content) {
        const memories = ((await kvGetJSON<{ id: number; content: string; category: string; created: string }[]>(env, "memory", "all")) || []).slice();
        memories.push({
          id: memories.length > 0 ? Math.max(...memories.map((m) => m.id)) + 1 : 0,
          content: cmd.content as string,
          category: (cmd.category as string) || "general",
          created: new Date().toISOString(),
        });
        await kvSetJSON(env, "memory", "all", memories);
        cmdResults.push(`Remembered: ${cmd.content}`);
      } else if (action === "forget" && cmd.id !== undefined) {
        let memories = ((await kvGetJSON<{ id: number }[]>(env, "memory", "all")) || []).slice();
        memories = memories.filter((m) => m.id !== cmd.id);
        memories.forEach((m, i) => ((m as { id: number }).id = i));
        await kvSetJSON(env, "memory", "all", memories);
        cmdResults.push(`Forgotten memory #${cmd.id}`);
      } else if (action === "falcon_eye" && cmd.intent) {
        let lat: number | null = null;
        let lon: number | null = null;
        if (cmd.region) {
          const hit = await geocodeRegion(cmd.region as string);
          if (hit) { lat = hit[0]; lon = hit[1]; }
        }
        if (lat == null && typeof cmd.lat === "number") lat = cmd.lat as number;
        if (lon == null && typeof cmd.lon === "number") lon = cmd.lon as number;
        const command = {
          id: crypto.randomUUID(),
          intent: cmd.intent,
          region: cmd.region || null,
          lat, lon,
          zoom: typeof cmd.zoom === "number" ? cmd.zoom : (cmd.region ? 4 : null),
          query: cmd.query || null,
          layer: cmd.layer || null,
          url: cmd.url || null,
          label: cmd.label || null,
          ts: Date.now(),
        };
        await kvSetJSON(env, "falcon-eye", "pending_command", { command, ts: command.ts });
        clientActions.push({ action: "falcon_eye", intent: cmd.intent, open: cmd.open !== false, command });
      } else if (action === "open_url" && cmd.url) {
        clientActions.push({ action: "open_url", url: cmd.url });
      } else if (action === "open_file" && cmd.path) {
        if (String(cmd.path).startsWith("http")) {
          clientActions.push({ action: "open_url", url: cmd.path });
        } else {
          const pending = ((await kvGetJSON<unknown[]>(env, "agent", "pending_commands")) || []).slice();
          pending.push({ action: "open_file", path: cmd.path, ts: Date.now() });
          await kvSetJSON(env, "agent", "pending_commands", pending);
          clientActions.push({ action: "queued", message: `Opening ${cmd.path} on your Mac` });
        }
      } else if (action === "create_file" && cmd.path && cmd.content) {
        const pending = ((await kvGetJSON<unknown[]>(env, "agent", "pending_commands")) || []).slice();
        pending.push({ action: "create_file", path: cmd.path, content: cmd.content, ts: Date.now() });
        await kvSetJSON(env, "agent", "pending_commands", pending);
        clientActions.push({ action: "queued", message: `Creating ${cmd.path} on your Mac` });
      } else if (action === "create_folder" && cmd.path) {
        const pending = ((await kvGetJSON<unknown[]>(env, "agent", "pending_commands")) || []).slice();
        pending.push({ action: "create_folder", path: cmd.path, ts: Date.now() });
        await kvSetJSON(env, "agent", "pending_commands", pending);
        clientActions.push({ action: "queued", message: `Creating folder ${cmd.path}` });
      } else if (action === "shell" && cmd.command) {
        const pending = ((await kvGetJSON<unknown[]>(env, "agent", "pending_commands")) || []).slice();
        pending.push({ action: "shell", command: cmd.command, ts: Date.now() });
        await kvSetJSON(env, "agent", "pending_commands", pending);
        clientActions.push({ action: "queued", message: `Running: ${cmd.command}` });
      } else if (action === "maps") {
        const modeFlags: Record<string, string> = { driving: "d", walking: "w", transit: "r" };
        let mapsUrl = "";
        if (cmd.type === "directions" && cmd.destination) {
          const flag = modeFlags[cmd.mode as string] || "d";
          mapsUrl = `maps://?daddr=${encodeURIComponent(cmd.destination as string)}&dirflg=${flag}`;
        } else if (cmd.type === "search" && cmd.query) {
          mapsUrl = `maps://?q=${encodeURIComponent(cmd.query as string)}`;
        } else if (cmd.type === "show" && cmd.location) {
          mapsUrl = `maps://?q=${encodeURIComponent(cmd.location as string)}`;
        }
        if (mapsUrl) {
          const pending = ((await kvGetJSON<unknown[]>(env, "agent", "pending_commands")) || []).slice();
          pending.push({ action: "shell", command: `open "${mapsUrl}"`, ts: Date.now() });
          await kvSetJSON(env, "agent", "pending_commands", pending);
          clientActions.push({ action: "open_maps", url: mapsUrl, type: cmd.type, destination: cmd.destination || cmd.query || cmd.location });
        }
      } else if (action === "play_music" && cmd.query) {
        const pending = ((await kvGetJSON<unknown[]>(env, "agent", "pending_commands")) || []).slice();
        pending.push({ action: "play_music", query: cmd.query, ts: Date.now() });
        await kvSetJSON(env, "agent", "pending_commands", pending);
        clientActions.push({ action: "play_music", query: cmd.query });
      } else if (action === "music_control" && cmd.command) {
        const pending = ((await kvGetJSON<unknown[]>(env, "agent", "pending_commands")) || []).slice();
        pending.push({ action: "music_control", command: cmd.command, ts: Date.now() });
        await kvSetJSON(env, "agent", "pending_commands", pending);
        clientActions.push({ action: "music_control", command: cmd.command });
      } else if (action === "fetch_url" && cmd.url) {
        try {
          const fRes = await fetch(cmd.url as string, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
          const fText = await fRes.text();
          const clean = fText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 4000);
          cmdResults.push(`Fetched ${cmd.url}: ${clean}`);
        } catch (e) {
          cmdResults.push(`Fetch error: ${(e as Error).message}`);
        }
      } else if (action === "get_weather" && cmd.location) {
        try {
          const origin = new URL(c.req.url).origin;
          const wUrl = `${origin}/api/weather?q=${encodeURIComponent(cmd.location as string)}`;
          const wRes = await fetch(wUrl, { signal: AbortSignal.timeout(10000) });
          const w = (await wRes.json()) as { current?: { emoji?: string; description?: string; temperature?: number; feelsLike?: number; humidity?: number; windSpeed?: number; windGusts?: number }; location?: string; forecast?: { date: string; emoji?: string; description?: string; high?: number; low?: number; precipChance?: number; windMax?: number }[]; error?: string };
          if (w.current) {
            const cc = w.current;
            let weatherText = `Weather for ${w.location}:\n`;
            weatherText += `${cc.emoji || ""} ${cc.description} · ${cc.temperature}°F (feels like ${cc.feelsLike}°F)\n`;
            weatherText += `Humidity: ${cc.humidity}% · Wind: ${cc.windSpeed} mph (gusts ${cc.windGusts} mph)\n`;
            if (w.forecast?.length) {
              weatherText += `\n7-day forecast:\n`;
              for (const d of w.forecast) {
                weatherText += `  ${d.date}: ${d.emoji || ""} ${d.description} · High ${d.high}°F / Low ${d.low}°F · ${d.precipChance}% precip · Wind ${d.windMax} mph\n`;
              }
            }
            cmdResults.push(weatherText);
          } else {
            cmdResults.push(`Weather lookup failed for "${cmd.location}": ${w.error || "unknown error"}`);
          }
        } catch (e) {
          cmdResults.push(`Weather error: ${(e as Error).message}`);
        }
      } else if (action === "search_web" && cmd.query) {
        const searchText = await tavilySearch(env, cmd.query as string, 8);
        cmdResults.push(searchText ? `Search results for "${cmd.query}":\n${searchText}` : `Search for "${cmd.query}" returned no results`);
      } else if (action === "open_search" && cmd.query) {
        clientActions.push({ action: "open_url", url: `https://www.google.com/search?q=${encodeURIComponent(cmd.query as string)}` });
      } else if (action === "computer_use" && cmd.goal) {
        await kvSetJSON(env, "agent", "pending_goal", { goal: cmd.goal, ts: Date.now() });
        await kvSetJSON(env, "agent", "status", { active: true, goal: cmd.goal, step: 0, thinking: "Waiting for terminal agent...", actions: [], done: false });
        clientActions.push({ action: "agent_started", goal: cmd.goal });
      } else if (action === "schedule" && cmd.task) {
        let tasks = ((await kvGetJSON<unknown[]>(env, "scheduler", "tasks")) || []).slice() as { id: string; task: string; execute_at: string; recurring: unknown; created: string }[];
        const executeAt = cmd.delay_minutes
          ? new Date(Date.now() + (cmd.delay_minutes as number) * 60000).toISOString()
          : (cmd.at as string) || new Date(Date.now() + 60000).toISOString();
        tasks.push({
          id: Math.random().toString(36).slice(2, 10),
          task: cmd.task as string,
          execute_at: executeAt,
          recurring: cmd.recurring_minutes || null,
          created: new Date().toISOString(),
        });
        await kvSetJSON(env, "scheduler", "tasks", tasks);
        clientActions.push({ action: "scheduled", task: cmd.task, at: executeAt, goal: cmd.task });
      } else if (action === "alert_add" && cmd.type) {
        const alerts = ((await kvGetJSON<unknown[]>(env, "alerts", "all")) || []).slice() as { id: string; type: string; config: unknown; active: boolean }[];
        const id = Math.random().toString(36).slice(2, 10);
        alerts.push({ id, type: cmd.type as string, config: cmd.config || {}, active: true });
        await kvSetJSON(env, "alerts", "all", alerts);
        cmdResults.push(`Alert set: ${cmd.type} — ${JSON.stringify(cmd.config || {})}`);
      } else if (action === "macro_add" && cmd.name) {
        const macros = ((await kvGetJSON<Record<string, string>>(env, "macros", "all")) || {}) as Record<string, string>;
        macros[(cmd.name as string).toLowerCase()] = (cmd.command as string) || "";
        await kvSetJSON(env, "macros", "all", macros);
        cmdResults.push(`Macro saved: ${cmd.name}`);
      } else if (action === "wiki_ingest" && cmd.content) {
        // Defer to /api/wiki natural_ingest
        try {
          const origin = new URL(c.req.url).origin;
          const r = await fetch(`${origin}/api/wiki`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "natural_ingest", content: cmd.content, title: cmd.title }),
            signal: AbortSignal.timeout(100000),
          });
          if (r.ok) {
            const d = (await r.json()) as { reply?: string };
            if (d.reply) cmdResults.push(d.reply);
          }
        } catch (e) {
          cmdResults.push(`Wiki ingest error: ${(e as Error).message}`);
        }
      }
    }

    // ── Force browse if needed ──
    const hasAgentAction = clientActions.some((a) => a.action === "agent_started");
    if (!hasAgentAction && needsBrowse(message)) {
      await kvSetJSON(env, "agent", "pending_goal", { goal: message, ts: Date.now() });
      await kvSetJSON(env, "agent", "status", { active: true, goal: message, step: 0, thinking: "Waiting for terminal agent...", actions: [], done: false });
      clientActions.push({ action: "agent_started", goal: message });
    }

    // ── Strip command blocks from visible reply ──
    reply = reply.replace(/```command\s*\n?[\s\S]*?\n?```/g, "").trim();

    // ── Follow-up LLM call if commands produced results ──
    let followUp: string | null = null;
    if (cmdResults.length > 0 && OLLAMA_KEY) {
      try {
        const followUpRes = await fetch("https://ollama.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: "system", content: `You are the user's personal AI assistant. NEVER say "Spectra" or your name. NEVER describe your personality. Address the user as "sir". ${timeBlock}\nThe user asked: "${message}"\nYou already told them: "${reply || "Looking into it"}"\nNow give the ACTUAL answer using the results below. Be thorough — include specific facts, numbers, names, dates. Do not repeat what you already said. Just deliver the information.` },
              { role: "user", content: `Results:\n${cmdResults.join("\n\n")}` },
            ],
            stream: false,
          }),
          signal: AbortSignal.timeout(60000),
        });
        if (followUpRes.ok) {
          const fData = (await followUpRes.json()) as { message?: { content?: string } };
          const fText = (fData.message?.content || "").replace(/```command[\s\S]*?```/g, "").trim();
          if (fText) {
            if (!reply) reply = fText;
            else followUp = fText;
          }
        }
      } catch {}
    }

    // Build fallback reply if still empty
    if (!reply && (clientActions.length > 0 || cmdResults.length > 0)) {
      const parts: string[] = [];
      if (cmdResults.length > 0) parts.push(cmdResults.join("\n").substring(0, 2000));
      for (const a of clientActions) {
        if (a.action === "scheduled") parts.push(`Scheduled: ${a.task}`);
        else if (a.action === "queued") parts.push(a.message as string);
        else if (a.action === "open_url") parts.push(`Opening ${a.url}`);
        else if (a.action === "agent_started") parts.push(`Browser agent launched: ${a.goal}`);
      }
      reply = parts.join("\n") || "Done, sir.";
    }
    if (!reply) reply = "Done, sir.";

    // ── Save history ──
    history.push(userMsg);
    history.push({ role: "assistant", content: followUp ? `${reply}\n\n${followUp}` : reply });
    if (history.length > 40) history = history.slice(-40);
    await kvSetJSON(env, "history", "conversation", history);

    const response: Record<string, unknown> = { reply };
    if (followUp) response.followUp = followUp;
    if (clientActions.length > 0) response.actions = clientActions;
    return c.json(response);
  } catch (err) {
    return c.json({ reply: `Connection error: ${(err as Error).message}` });
  }
});
