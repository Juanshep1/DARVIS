import { getStore } from "@netlify/blobs";

// ── Tavily web search (upgraded: more results, deeper content) ──────────────

async function tavilySearch(query, maxResults = 8) {
  const TAVILY_KEY = Netlify.env.get("TAVILY_API_KEY");
  if (!TAVILY_KEY) return null;

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query,
        search_depth: "advanced",
        max_results: maxResults,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    let text = "";
    if (data.answer) {
      text += `Answer: ${data.answer}\n\n`;
    }
    if (data.results?.length) {
      text += "Sources:\n";
      data.results.forEach((r, i) => {
        text += `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content?.substring(0, 500) || ""}\n\n`;
      });
    }
    return text || null;
  } catch {
    return null;
  }
}

// ── Follow-up detection + query rewrite ────────────────────────────────────
// Tavily does literal keyword search — it can't resolve pronouns. When a user
// asks "how long till it starts" after talking about the Super Bowl, we need
// to rewrite the query to "how long until Super Bowl LIX starts" before the
// search, or Tavily will return unrelated results.

function isAmbiguousFollowup(msg, historyLen) {
  if (historyLen < 2) return false;
  const lower = msg.toLowerCase().trim();
  // Pronouns and deixis that depend on prior context
  if (/\b(it|its|that|this|they|them|those|these|there|their|he|she|his|her|him)\b/.test(lower)) return true;
  // Elliptical follow-ups with no explicit subject
  if (/\b(till|until|by then|since then|what about|how about|and (you|then)|more about|same|also|too|instead)\b/.test(lower)) return true;
  // Very short questions rarely stand alone
  if (msg.trim().split(/\s+/).length <= 5) return true;
  return false;
}

async function rewriteSearchQuery(msg, history) {
  const GEMINI_KEY = Netlify.env.get("GEMINI_API_KEY");
  if (!GEMINI_KEY) return null;
  const last = (history || []).slice(-6).filter(m => m?.role && m?.content);
  if (last.length < 2) return null;
  const ctx = last.map(m => `${m.role === 'assistant' ? 'assistant' : 'user'}: ${String(m.content).substring(0, 400)}`).join('\n');
  const prompt = `Rewrite the user's latest message into a standalone web search query. Expand pronouns ("it", "that", "they", "there") using the conversation. Keep proper nouns, dates, and numbers. If the latest message already stands alone, return it unchanged. Output ONLY the rewritten query on a single line — no quotes, no explanation.

Conversation:
${ctx}

Latest message: ${msg}

Standalone search query:`;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 100, temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!r.ok) return null;
    const d = await r.json();
    let rewritten = d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!rewritten) return null;
    // Strip wrapping quotes / trailing punctuation noise
    rewritten = rewritten.replace(/^["'`]+|["'`]+$/g, '').split('\n')[0].trim();
    // Guard: if the rewrite is nonsense (too long, or identical, or empty) bail
    if (rewritten.length < 2 || rewritten.length > 300) return null;
    if (rewritten.toLowerCase() === msg.toLowerCase().trim()) return null;
    return rewritten;
  } catch {
    return null;
  }
}

// ── Detect if a message needs browser agent ─────────────────────────────────

function needsBrowse(msg) {
  const lower = msg.toLowerCase();
  // Don't trigger browse for file/folder/desktop operations
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

// ── Detect if a message needs web search ────────────────────────────────────

function needsSearch(msg) {
  const lower = msg.toLowerCase().trim();
  if (!lower) return false;

  // Conversation openers / casual chat — never search
  const chatter = [
    /^(hi|hey|hello|yo|sup|good (morning|afternoon|evening|night))\b/,
    /^(thanks|thank you|thx|cheers|nice|cool|awesome|great|ok|okay|k)\b/,
    /^(are you there|you there|you awake|can you hear me)\b/,
    /^(what can you do|what are you|who are you)\b/,
    /^(shut up|stop|pause|be quiet|nevermind|never mind|cancel)\b/,
    /^(yes|yeah|yep|yup|no|nope|nah|sure|fine|maybe)[\s.!?]*$/,
  ];
  if (chatter.some((re) => re.test(lower))) return false;

  // Action commands that should NOT search (they trigger other handlers)
  const nonSearchActions = [
    /^(open|launch|start|close|quit|kill)\s/,
    /^(create|write|make|save|generate)\s.*(file|folder|document|note|text|script)/,
    /^(play|pause|skip|resume|next|previous|stop)\b/,
    /^(remember|forget|remind me|set a reminder|set a timer)\b/,
    /^(schedule|set an alert)\b/,
    /^(run |execute |shell )/,
  ];
  if (nonSearchActions.some((re) => re.test(lower))) return false;

  // QUESTIONS — default to search. Your training data is frozen;
  // the web is live. Search whenever the user asks anything factual.
  if (/^(who|what|when|where|why|how|which|whose|whom)\b/.test(lower)) return true;
  if (/^(is |are |was |were |do |does |did |has |have |had |can |could |will |would |should |may |might )/.test(lower)) return true;
  if (/\?\s*$/.test(lower)) return true;

  // Explicit factual / temporal / named-entity triggers
  const triggers = [
    // Direct search verbs
    "search", "look up", "google", "find out", "find me", "show me",
    "tell me", "look it up", "check", "what about",
    // Temporal
    "latest", "today", "tonight", "yesterday", "this week", "this month",
    "this year", "right now", "currently", "current", "recent", "recently",
    "just happened", "this morning", "this afternoon", "this evening",
    "last night", "last week", "last month", "last year", "now ",
    "live ", "upcoming", "tomorrow",
    // Sports / events
    "score", "scores", "record", "standings", "playoffs", "championship",
    "who won", "who is winning", "who lost", "results", "highlights", "game",
    "match", "final", "semifinal", "tournament", "league", "season",
    "bracket", "draft", "trade", "signed",
    // News / markets
    "news", "headline", "breaking", "update", "weather", "forecast",
    "temperature", "price", "stock", "crypto", "bitcoin", "ethereum",
    "market", "shares", "index", "earnings", "rate", "inflation", "fed",
    "dow", "nasdaq", "s&p",
    // People / positions
    "president", "prime minister", "ceo", "founder", "owner", "senator",
    "governor", "mayor", "coach", "manager",
    // Reference / factual
    "how much", "how many", "how old", "when is", "when does", "when did",
    "where is", "where does", "how long", "how far", "how tall",
    // Curiosity / lookup
    "tell me about", "what happened", "what is going on", "what's going on",
    "catch me up", "info on", "details about", "background on",
    "history of", "details on", "biography", "bio of", "summary of",
    // Wiki-ish
    "wiki", "wikipedia", "encyclopedia", "define", "definition",
    // Trending
    "trending", "viral", "going viral", "hot right now", "released",
    "released today", "box office", "rankings", "top 10", "best ",
    // Places
    "restaurant", "open right now", "near me", "hours of", "phone number",
    "address of", "map of", "directions",
  ];
  return triggers.some((t) => lower.includes(t));
}

// ── Main handler ────────────────────────────────────────────────────────────

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { message, tz: clientTZ } = await req.json();
  if (!message) {
    return Response.json({ error: "No message" }, { status: 400 });
  }

  const OLLAMA_KEY = Netlify.env.get("OLLAMA_API_KEY");
  let wikiStore;
  try { wikiStore = getStore("darvis-wiki"); } catch { wikiStore = null; }

  // ── NATURAL LANGUAGE WIKI INGEST — handled inline (needs chat's 120s timeout) ──
  const lowerMsg = message.toLowerCase();
  const ingestTriggers = ["ingest this:", "add to wiki:", "add this to wiki:", "wiki this:", "save to wiki:"];
  const ingestMatch = ingestTriggers.find(t => lowerMsg.includes(t));
  if (ingestMatch) {
    try {
      const idx = lowerMsg.indexOf(ingestMatch);
      let rawContent = message.substring(idx + ingestMatch.length).trim();
      // Strip common filler after the trigger ("into the wiki", "with title X:")
      rawContent = rawContent.replace(/^into the wiki\s*(with title\s*"[^"]*"\s*:?\s*)?/i, "").trim();
      if (rawContent.length < 5) {
        return Response.json({ reply: "I need more content to ingest, sir. Say: ingest this: [your information]" });
      }

      let title = rawContent.substring(0, 60).replace(/\n/g, " ").trim();

      // Store as pending ingest for the daemon to process (avoids CDN timeout)
      if (wikiStore) {
        await wikiStore.setJSON("pending_ingest", { content: rawContent, title, ts: Date.now() });
      }

      // Also store as a pending command for the daemon
      const cmdStore = getStore("darvis-agent");
      let pending = [];
      try { const d = await cmdStore.get("pending_commands", { type: "json" }); if (Array.isArray(d)) pending = d; } catch {}
      pending.push({ action: "wiki_ingest", content: rawContent.substring(0, 30000), title, ts: Date.now() });
      await cmdStore.setJSON("pending_commands", pending);

      return Response.json({ reply: `Noted, sir. Ingesting "${title}" into the wiki. Your Mac will process it in the background — check /wiki list in a moment.` });
    } catch (e) {
      return Response.json({ reply: `Wiki ingest error: ${e.message}` });
    }
  }

  // ── PARALLEL LOAD: settings + history + memory + wiki index + search all at once ──
  const settingsStore = getStore("darvis-settings");
  const historyStore = getStore("darvis-history");
  const memoryStore = getStore("darvis-memory");

  // Load settings, history, memory, wiki index first
  const [settingsData, historyData, memoryData, wikiIndexData] = await Promise.all([
    settingsStore.get("current", { type: "json" }).catch(() => null),
    historyStore.get("conversation", { type: "json" }).catch(() => null),
    memoryStore.get("all", { type: "json" }).catch(() => null),
    wikiStore.get("index", { type: "json" }).catch(() => null),
  ]);

  // Build contextual search query using conversation history.
  // For ambiguous follow-ups ("how long till it starts"), ask Gemini Flash
  // to rewrite the query into a standalone form before hitting Tavily so
  // pronouns get resolved to the actual subject from earlier turns.
  let searchQuery = message;
  const shouldSearch = needsSearch(message);
  if (shouldSearch) {
    const rawHistory = Array.isArray(historyData) ? historyData : [];
    if (isAmbiguousFollowup(message, rawHistory.length)) {
      const rewritten = await rewriteSearchQuery(message, rawHistory);
      if (rewritten) {
        searchQuery = rewritten;
      } else {
        // Fallback: prepend last assistant/user turn so Tavily at least has
        // the prior subject in its keyword pool
        const recentCtx = rawHistory.slice(-4).map(m => m.content || '').join(' ').substring(0, 300);
        if (recentCtx) searchQuery = `${recentCtx} ${message}`.substring(0, 400);
      }
    }
  }

  const searchResults = shouldSearch ? await tavilySearch(searchQuery, 10) : null;

  let MODEL = settingsData?.model || Netlify.env.get("DARVIS_MODEL") || "glm-5";
  const isLocalModel = MODEL.startsWith("local:");
  const actualModel = isLocalModel ? MODEL.replace("local:", "") : MODEL;
  let history = Array.isArray(historyData) ? historyData : [];

  // Keep only last 20 messages and clean any chain-of-thought junk
  history = history.slice(-20).filter(m => {
    if (!m.role || !m.content) return false;
    // Remove thinking/reasoning artifacts from qwen/deepseek models
    if (m.role === 'assistant' && (
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

  // ── Wiki context: search index for relevant pages ──
  let wikiContext = "";
  if (wikiIndexData && wikiIndexData.pages && Object.keys(wikiIndexData.pages).length > 0) {
    const queryWords = message.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scored = [];
    for (const [id, entry] of Object.entries(wikiIndexData.pages)) {
      const text = `${entry.title || ""} ${entry.summary || ""} ${(entry.tags || []).join(" ")}`.toLowerCase();
      const score = queryWords.filter(w => text.includes(w)).length;
      if (score > 0) scored.push({ id, ...entry, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const topPages = scored.slice(0, 3);
    if (topPages.length > 0) {
      const pageContents = await Promise.all(
        topPages.map(p => wikiStore.get(`page:${p.id}`, { type: "json" }).catch(() => null))
      );
      const parts = [];
      for (const page of pageContents) {
        if (page && page.content) {
          const content = page.content.length > 2000 ? page.content.substring(0, 2000) + "..." : page.content;
          parts.push(`### ${page.title || "Untitled"} (${page.type || "page"})\n${content}`);
        }
      }
      if (parts.length > 0) {
        wikiContext = "\n\nRelevant wiki knowledge:\n" + parts.join("\n\n");
      }
    }
  }

  let searchContext = "";
  if (searchResults) {
    const queryNote = searchQuery !== message
      ? `User asked: "${message}"\nResolved search query (pronouns expanded from conversation): "${searchQuery}"`
      : `Search query: "${message}"`;
    searchContext = `\n\nWEB SEARCH RESULTS\n${queryNote}\n\n${searchResults}\nIMPORTANT: Use ONLY these search results for factual claims. Do NOT use your training data for facts that could be outdated. The results are current. Answer the user's ORIGINAL question directly, using the resolved subject from the search. Cite specific facts, numbers, dates exactly as shown.`;
  }

  // ── Pre-fetch weather if the query mentions weather/forecast/temperature ──
  // This injects the data directly into the prompt so the LLM doesn't need to
  // emit a command block — it just reads the data and responds naturally.
  let weatherContext = "";
  const lowerMsgW = message.toLowerCase();
  const weatherTriggers = ["weather", "forecast", "temperature", "rain", "snow", "wind", "humidity", "outside", "cold", "hot", "warm", "storm", "sunny", "cloudy"];
  if (weatherTriggers.some((t) => lowerMsgW.includes(t))) {
    // Extract city name — look for "in <city>" or "for <city>" patterns
    let city = "";
    const inMatch = lowerMsgW.match(/(?:weather|forecast|temperature|rain|snow|wind|storm|humidity)\s+(?:in|for|at|near)\s+([a-zA-Z\s,]+?)(?:\?|$|\.|\!)/i);
    if (inMatch) city = inMatch[1].trim();
    if (!city) {
      const forMatch = message.match(/(?:in|for|at|near)\s+([A-Z][a-zA-Z\s,]+?)(?:\?|$|\.|\!)/);
      if (forMatch) city = forMatch[1].trim();
    }
    if (!city) city = "Dallas"; // user's default location

    try {
      const wRes = await fetch(`https://darvis1.netlify.app/api/weather?q=${encodeURIComponent(city)}`, { signal: AbortSignal.timeout(8000) });
      const w = await wRes.json();
      if (w.current) {
        const c = w.current;
        weatherContext = `\n\nREAL-TIME WEATHER DATA (just fetched, accurate right now):\nLocation: ${w.location}\n`;
        weatherContext += `Current: ${c.emoji} ${c.description} · ${c.temperature}°F (feels like ${c.feelsLike}°F) · Humidity ${c.humidity}% · Wind ${c.windSpeed} mph (gusts ${c.windGusts} mph)\n`;
        if (w.forecast?.length) {
          weatherContext += `Forecast:\n`;
          for (const d of w.forecast) {
            weatherContext += `  ${d.date}: ${d.emoji} ${d.description} · High ${d.high}°F / Low ${d.low}°F · ${d.precipChance}% precip chance\n`;
          }
        }
        weatherContext += `\nIMPORTANT: This weather data is LIVE. Use it directly in your response. Do NOT say you can't access weather — the data is right here.`;
      }
    } catch (e) {}
  }

  // Use the device-reported timezone if the client sent one; otherwise fall
  // back to Central (the user's home TZ). This lets every surface — browser,
  // iOS, daemon — get accurate local time without hardcoding.
  const d = new Date();
  const userTZ = (typeof clientTZ === "string" && clientTZ.length > 0 && clientTZ.length < 64) ? clientTZ : "America/Chicago";
  let localTime, localHour;
  try {
    localTime = d.toLocaleString("en-US", { timeZone: userTZ, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric", hour12: true, timeZoneName: "short" });
    localHour = parseInt(d.toLocaleString("en-US", { timeZone: userTZ, hour: "numeric", hour12: false }));
  } catch {
    localTime = d.toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric", hour12: true });
    localHour = parseInt(d.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }));
  }
  const period = localHour < 6 ? "LATE NIGHT" : localHour < 12 ? "MORNING" : localHour < 17 ? "AFTERNOON" : localHour < 21 ? "EVENING" : "NIGHT";
  const timeBlock = `CURRENT DATE/TIME (ground truth — the REAL time on the user's device, NOT your training cutoff):\n  Date: ${localTime}\n  Period: ${period}\n  Timezone: ${userTZ}\n  Epoch: ${d.getTime()}\nDo NOT guess the time. If asked "what time is it?", answer using this value exactly.`;

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
- Be thorough but fast. Aim for 3–5 substantive sentences on most queries, longer only when the user asks for depth (briefing, summary, breakdown, deep dive). Skip throat-clearing — no "Certainly, sir. I'd be delighted to..." openings. Start with the answer.
- For news or briefings, give 5+ stories with 1–2 sentences of real substance each. No lazy headlines.
- Pay attention to conversation history. If the user says "their record" or "what about them", reuse the previous subject instead of asking them to repeat themselves.
- Both Classic and Gemini voice modes now route through this endpoint, so every query should respond as if the user can hear you. Use natural sentence flow, not bullet lists, when the reply will be spoken.

You run on ${MODEL} via Ollama Cloud across iPhone, web browser, macOS terminal.

## Available Commands (use as command blocks):

### Web Search (for real-time info):
\`\`\`command
{"action": "search_web", "query": "search terms here"}
\`\`\`
Use this when you need current information and no search results are provided below.

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
CRITICAL: When the user says "create a file", "write a file", "save to desktop", "make a document", "make a file about...", etc., you MUST output a create_file command block with the FULL content. Use ~/Desktop/ as default location. The file will be created AND automatically opened on the user's Mac — do NOT add a separate shell command to open it. This works cross-device even from mobile.

### Create Folder:
\`\`\`command
{"action": "create_folder", "path": "~/Desktop/folder_name"}
\`\`\`

### Open File (on user's Mac):
\`\`\`command
{"action": "open_file", "path": "~/Desktop/filename.txt"}
\`\`\`
Use when the user asks to open an existing file. Use the EXACT filename — do not guess or change the name.

### Play Music (Apple Music — works on Mac, iPhone, and browser):
\`\`\`command
{"action": "play_music", "query": "song name by artist"}
\`\`\`
Use when the user says "play [song]", "play [song] by [artist]", "put on [song]", "play some [genre]", etc.
The query should be the song name and artist (e.g. "Blinding Lights by The Weeknd"). Include the artist if the user mentions one.
Also supports: "pause music", "skip", "next song", "previous song", "resume music".
\`\`\`command
{"action": "music_control", "command": "pause"}
\`\`\`
Valid commands: pause, play, next, previous, stop

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
Use for: directions/navigation (modes: driving, walking, transit), nearby search, showing locations. Works on Mac and iPhone.

### Shell Command (runs on user's Mac):
\`\`\`command
{"action": "shell", "command": "ls ~/Desktop"}
\`\`\`
Use for system commands. Do NOT use shell to open files — use open_file instead. Do NOT use shell for music — use play_music instead. Do NOT use shell for maps — use the maps action instead.

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
Use for: shopping, form filling, complex site navigation, visual tasks.
Do NOT use for simple searches or general questions.

### Schedule:
\`\`\`command
{"action": "schedule", "delay_minutes": 30, "task": "description"}
\`\`\`
\`\`\`command
{"action": "schedule", "at": "2026-04-09T08:00:00", "task": "remind me to call mom"}
\`\`\`

### Weather (real-time, any city):
\`\`\`command
{"action": "get_weather", "location": "Dallas"}
\`\`\`
\`\`\`command
{"action": "get_weather", "location": "Tokyo"}
\`\`\`
Use when the user asks about weather, temperature, forecast, rain, snow, wind, or "what's it like outside". The location should be a city name. Results will be injected and you'll give a follow-up with the actual conditions.

### Alerts:
\`\`\`command
{"action": "alert_add", "type": "news_keyword", "config": {"keyword": "SpaceX"}}
\`\`\`
\`\`\`command
{"action": "alert_add", "type": "price_threshold", "config": {"symbol": "AAPL", "threshold": 200, "direction": "above"}}
\`\`\`

### Macros:
\`\`\`command
{"action": "macro_add", "name": "deploy", "command": "cd site && netlify deploy --prod"}
\`\`\`

### Screen Analysis:
\`\`\`command
{"action": "analyze_screen", "prompt": "What error is on screen?"}
\`\`\`

### Wiki (persistent knowledge base):
\`\`\`command
{"action": "wiki_ingest", "title": "descriptive title", "content": "the text to process into wiki pages"}
\`\`\`
Use when the user shares substantial info that should be preserved long-term (articles, notes, research, etc.)

Common shortcuts:
- "open YouTube" → open_url https://youtube.com
- "open Gmail" → open_url https://mail.google.com
- "Google X" → open_search with the query
- "remind me in 30 min" → schedule with delay_minutes
- "alert me when Tesla hits $300" → alert_add price_threshold

### Falcon Eye (3D global surveillance grid):
\`\`\`command
{"action": "falcon_eye", "intent": "focus_region", "region": "Ukraine", "lat": 50.45, "lon": 30.52, "zoom": 4, "open": true}
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
{"action": "falcon_eye", "intent": "add_camera", "url": "https://camlist.net/.../stream.m3u8", "label": "Tokyo Shibuya", "lat": 35.66, "lon": 139.70}
\`\`\`
\`\`\`command
{"action": "falcon_eye", "intent": "reset"}
\`\`\`
CRITICAL — Use Falcon Eye when the user mentions anything like: "falcon eye", "show me <country/city>", "take me to <place>", "zoom into X", "track planes/satellites over X", "what's happening in <region>", "war alerts", "track the ISS / Hubble / Starlink", "follow that satellite", "open the globe", "satellites above", "earthquakes", "wildfires", "severe weather", or any request to add a camera/webcam to the map.

For Falcon Eye requests you MUST emit a \`\`\`command ... \`\`\` block — do NOT respond with only prose like "Tracking the ISS, sir". The prose reply is fine but the command block is REQUIRED or nothing actually happens on the globe. You do NOT need to know coordinates; the server auto-geocodes region names. Just use the region field with the country/city name (e.g. "region": "Ukraine", "region": "Tokyo"). For satellites/aircraft use the query field (e.g. "query": "ISS", "query": "UAL123"). Set "open": true to open Falcon Eye in a new tab if it isn't already.${memoryContext}${wikiContext}${searchContext}${weatherContext}`;

  const userMsg = { role: "user", content: `${timeBlock}\n${message}` };
  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    userMsg,
  ];

  try {
    // If local model selected, route through daemon for local Ollama processing
    if (isLocalModel) {
      const cmdStore = getStore("darvis-agent");
      const requestId = `lchat-${Date.now()}`;
      // Store the chat request for the daemon to process
      await cmdStore.setJSON("pending_local_chat", {
        id: requestId,
        model: actualModel,
        messages,
        ts: Date.now(),
      });
      // Poll for response (daemon will store it)
      for (let i = 0; i < 24; i++) { // 24 * 5s = 120s max
        await new Promise(r => setTimeout(r, 5000));
        const resp = await cmdStore.get("local_chat_response", { type: "json" }).catch(() => null);
        if (resp && resp.id === requestId && resp.reply) {
          await cmdStore.delete("local_chat_response");
          // Save history
          try {
            history.push(userMsg);
            history.push({ role: "assistant", content: resp.reply });
            if (history.length > 40) history = history.slice(-40);
            await historyStore.setJSON("conversation", history);
          } catch {}
          return Response.json({ reply: resp.reply });
        }
      }
      return Response.json({ reply: "Local model timed out, sir. Make sure Ollama is running on your Mac." });
    }

    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OLLAMA_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, messages, stream: false }),
      signal: AbortSignal.timeout(110000),
    });

    if (!res.ok) {
      const err = await res.text();
      return Response.json(
        { reply: `API error: ${res.status} ${err}` },
        { status: 200 }
      );
    }

    const data = await res.json();
    let reply = data.message?.content || "No response";

    // Extract all command blocks (flexible: handles optional newlines, spaces, etc.)
    const cmdPattern = /```command\s*\n?([\s\S]*?)\n?```/g;
    let match;
    const clientActions = [];
    const cmdResults = [];

    while ((match = cmdPattern.exec(reply)) !== null) {
      try {
        const cmd = JSON.parse(match[1]);

        if (cmd.action === "remember" && cmd.content) {
          let memories = [];
          try {
            const d = await memoryStore.get("all", { type: "json" });
            if (Array.isArray(d)) memories = d;
          } catch {}
          memories.push({
            id: memories.length > 0 ? Math.max(...memories.map((m) => m.id)) + 1 : 0,
            content: cmd.content,
            category: cmd.category || "general",
            created: new Date().toISOString(),
          });
          await memoryStore.setJSON("all", memories);
          cmdResults.push(`Remembered: ${cmd.content}`);
        } else if (cmd.action === "forget" && cmd.id !== undefined) {
          let memories = [];
          try {
            const d = await memoryStore.get("all", { type: "json" });
            if (Array.isArray(d)) memories = d;
          } catch {}
          memories = memories.filter((m) => m.id !== cmd.id);
          memories.forEach((m, i) => (m.id = i));
          await memoryStore.setJSON("all", memories);
          cmdResults.push(`Forgotten memory #${cmd.id}`);
        } else if (cmd.action === "falcon_eye" && cmd.intent) {
          // Real geocoder via Nominatim (OpenStreetMap, free, no key).
          // Falls through to the hotspot table for common hits and as a
          // cache for rate-limit-friendly performance.
          async function geocodeRegion(query) {
            try {
              if (!query || typeof query !== "string") return null;
              const key = query.toLowerCase().trim();
              if (FE_HOTSPOTS[key]) return FE_HOTSPOTS[key];
              for (const [k, v] of Object.entries(FE_HOTSPOTS)) {
                if (key.includes(k)) return v;
              }
              const u = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
              const r = await fetch(u, {
                headers: {
                  "User-Agent": "FalconEye/1.0 (darvis1.netlify.app)",
                  "Accept-Language": "en",
                },
                signal: AbortSignal.timeout(6000),
              });
              if (!r.ok) return null;
              const arr = await r.json();
              if (Array.isArray(arr) && arr.length) {
                const la = parseFloat(arr[0].lat);
                const lo = parseFloat(arr[0].lon);
                if (!isNaN(la) && !isNaN(lo)) return [la, lo];
              }
            } catch (e) {
              console.warn("geocodeRegion:", e?.message || e);
            }
            return null;
          }
          // Geocode region → lat/lon so the LLM only needs to name the place
          const FE_HOTSPOTS = {
            ukraine:[50.45,30.52],russia:[55.75,37.62],israel:[31.78,35.22],
            gaza:[31.50,34.47],lebanon:[33.89,35.50],iran:[35.69,51.39],
            syria:[33.51,36.29],yemen:[15.37,44.19],taiwan:[25.03,121.57],
            china:[39.90,116.40],japan:[35.68,139.69],"north korea":[39.02,125.75],
            "south korea":[37.57,126.98],india:[28.61,77.21],pakistan:[33.68,73.05],
            afghanistan:[34.53,69.17],turkey:[39.93,32.85],iraq:[33.31,44.36],
            "saudi arabia":[24.71,46.68],egypt:[30.04,31.24],libya:[32.89,13.19],
            sudan:[15.50,32.56],ethiopia:[9.03,38.74],nigeria:[9.07,7.48],
            "south africa":[-25.75,28.19],kenya:[-1.29,36.82],somalia:[2.05,45.32],
            morocco:[34.02,-6.83],france:[48.85,2.35],germany:[52.52,13.40],
            uk:[51.51,-0.13],"united kingdom":[51.51,-0.13],england:[51.51,-0.13],
            london:[51.51,-0.13],ireland:[53.35,-6.26],spain:[40.42,-3.70],
            italy:[41.90,12.50],greece:[37.98,23.73],poland:[52.23,21.01],
            sweden:[59.33,18.07],norway:[59.91,10.75],finland:[60.17,24.94],
            denmark:[55.68,12.57],netherlands:[52.37,4.90],belgium:[50.85,4.35],
            switzerland:[46.95,7.45],austria:[48.21,16.37],hungary:[47.50,19.04],
            romania:[44.43,26.10],bulgaria:[42.70,23.32],serbia:[44.79,20.46],
            croatia:[45.81,15.98],portugal:[38.72,-9.14],brazil:[-15.78,-47.93],
            argentina:[-34.61,-58.38],chile:[-33.45,-70.67],mexico:[19.43,-99.13],
            venezuela:[10.49,-66.88],colombia:[4.71,-74.07],peru:[-12.05,-77.04],
            canada:[45.42,-75.69],"united states":[38.90,-77.04],usa:[38.90,-77.04],
            america:[38.90,-77.04],"new york":[40.71,-74.00],washington:[38.90,-77.04],
            california:[37.77,-122.42],"los angeles":[34.05,-118.24],chicago:[41.88,-87.63],
            miami:[25.76,-80.19],texas:[30.27,-97.74],australia:[-35.28,149.13],
            "new zealand":[-41.29,174.78],singapore:[1.35,103.82],thailand:[13.76,100.50],
            vietnam:[21.03,105.85],philippines:[14.60,120.98],indonesia:[-6.21,106.85],
            malaysia:[3.14,101.69],"hong kong":[22.32,114.17],dubai:[25.20,55.27],
            uae:[24.45,54.38],qatar:[25.29,51.53],kuwait:[29.38,47.99],
            jordan:[31.95,35.93],tokyo:[35.68,139.69],beijing:[39.90,116.40],
            moscow:[55.75,37.62],paris:[48.85,2.35],berlin:[52.52,13.40],
            rome:[41.90,12.50],madrid:[40.42,-3.70],istanbul:[41.01,28.98],
            cairo:[30.04,31.24],kyiv:[50.45,30.52],kiev:[50.45,30.52],
            tehran:[35.69,51.39],baghdad:[33.31,44.36],riyadh:[24.71,46.68],
          };
          // Always prefer the geocoded result over LLM-supplied coords
          let lat = null, lon = null;
          try {
            if (cmd.region) {
              const hit = await geocodeRegion(cmd.region);
              if (hit) { lat = hit[0]; lon = hit[1]; }
            }
          } catch (e) { console.warn("fe geocode:", e?.message || e); }
          if (lat == null && typeof cmd.lat === "number") lat = cmd.lat;
          if (lon == null && typeof cmd.lon === "number") lon = cmd.lon;

          const feStore = getStore("darvis-falcon-eye");
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
          await feStore.setJSON("pending_command", { command, ts: command.ts });
          clientActions.push({ action: "falcon_eye", intent: cmd.intent, open: cmd.open !== false, command });
        } else if (cmd.action === "open_url" && cmd.url) {
          clientActions.push({ action: "open_url", url: cmd.url });
        } else if (cmd.action === "open_file" && cmd.path) {
          if (cmd.path.startsWith("http")) {
            clientActions.push({ action: "open_url", url: cmd.path });
          } else {
            const cmdStore = getStore("darvis-agent");
            let pending = [];
            try { const d = await cmdStore.get("pending_commands", { type: "json" }); if (Array.isArray(d)) pending = d; } catch {}
            pending.push({ action: "open_file", path: cmd.path, ts: Date.now() });
            await cmdStore.setJSON("pending_commands", pending);
            clientActions.push({ action: "queued", message: `Opening ${cmd.path} on your Mac` });
          }
        } else if (cmd.action === "create_file" && cmd.path && cmd.content) {
          const cmdStore = getStore("darvis-agent");
          let pending = [];
          try { const d = await cmdStore.get("pending_commands", { type: "json" }); if (Array.isArray(d)) pending = d; } catch {}
          pending.push({ action: "create_file", path: cmd.path, content: cmd.content, ts: Date.now() });
          await cmdStore.setJSON("pending_commands", pending);
          clientActions.push({ action: "queued", message: `Creating ${cmd.path} on your Mac` });
        } else if (cmd.action === "create_folder" && cmd.path) {
          const cmdStore = getStore("darvis-agent");
          let pending = [];
          try { const d = await cmdStore.get("pending_commands", { type: "json" }); if (Array.isArray(d)) pending = d; } catch {}
          pending.push({ action: "create_folder", path: cmd.path, ts: Date.now() });
          await cmdStore.setJSON("pending_commands", pending);
          clientActions.push({ action: "queued", message: `Creating folder ${cmd.path}` });
        } else if (cmd.action === "shell" && cmd.command) {
          const cmdStore = getStore("darvis-agent");
          let pending = [];
          try { const d = await cmdStore.get("pending_commands", { type: "json" }); if (Array.isArray(d)) pending = d; } catch {}
          pending.push({ action: "shell", command: cmd.command, ts: Date.now() });
          await cmdStore.setJSON("pending_commands", pending);
          clientActions.push({ action: "queued", message: `Running: ${cmd.command}` });
        } else if (cmd.action === "safari" && cmd.method) {
          const cmdStore = getStore("darvis-agent");
          let pending = [];
          try { const d = await cmdStore.get("pending_commands", { type: "json" }); if (Array.isArray(d)) pending = d; } catch {}
          pending.push({ action: "safari", ...cmd, ts: Date.now() });
          await cmdStore.setJSON("pending_commands", pending);
          clientActions.push({ action: "queued", message: `Safari: ${cmd.method}` });
        } else if (cmd.action === "maps") {
          const modeFlags = { driving: "d", walking: "w", transit: "r" };
          let mapsUrl = "";
          if (cmd.type === "directions" && cmd.destination) {
            const flag = modeFlags[cmd.mode] || "d";
            mapsUrl = `maps://?daddr=${encodeURIComponent(cmd.destination)}&dirflg=${flag}`;
          } else if (cmd.type === "search" && cmd.query) {
            mapsUrl = `maps://?q=${encodeURIComponent(cmd.query)}`;
          } else if (cmd.type === "show" && cmd.location) {
            mapsUrl = `maps://?q=${encodeURIComponent(cmd.location)}`;
          }
          if (mapsUrl) {
            // Queue for daemon (Mac) AND send to client (browser/iOS)
            const cmdStore = getStore("darvis-agent");
            let pending = [];
            try { const d = await cmdStore.get("pending_commands", { type: "json" }); if (Array.isArray(d)) pending = d; } catch {}
            pending.push({ action: "shell", command: `open "${mapsUrl}"`, ts: Date.now() });
            await cmdStore.setJSON("pending_commands", pending);
            clientActions.push({ action: "open_maps", url: mapsUrl, type: cmd.type, destination: cmd.destination || cmd.query || cmd.location });
          }
        } else if (cmd.action === "play_music" && cmd.query) {
          // Queue for Mac daemon AND send to browser client
          const cmdStore = getStore("darvis-agent");
          let pending = [];
          try { const d = await cmdStore.get("pending_commands", { type: "json" }); if (Array.isArray(d)) pending = d; } catch {}
          pending.push({ action: "play_music", query: cmd.query, ts: Date.now() });
          await cmdStore.setJSON("pending_commands", pending);
          clientActions.push({ action: "play_music", query: cmd.query });
        } else if (cmd.action === "music_control" && cmd.command) {
          const cmdStore = getStore("darvis-agent");
          let pending = [];
          try { const d = await cmdStore.get("pending_commands", { type: "json" }); if (Array.isArray(d)) pending = d; } catch {}
          pending.push({ action: "music_control", command: cmd.command, ts: Date.now() });
          await cmdStore.setJSON("pending_commands", pending);
          clientActions.push({ action: "music_control", command: cmd.command });
        } else if (cmd.action === "fetch_url" && cmd.url) {
          try {
            const fRes = await fetch(cmd.url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
            const fText = await fRes.text();
            const clean = fText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 4000);
            cmdResults.push(`Fetched ${cmd.url}: ${clean}`);
          } catch (e) {
            cmdResults.push(`Fetch error: ${e.message}`);
          }
        } else if (cmd.action === "get_weather" && cmd.location) {
          try {
            const wUrl = `https://darvis1.netlify.app/api/weather?q=${encodeURIComponent(cmd.location)}`;
            const wRes = await fetch(wUrl, { signal: AbortSignal.timeout(10000) });
            const w = await wRes.json();
            if (w.current) {
              const c = w.current;
              let weatherText = `Weather for ${w.location}:\n`;
              weatherText += `${c.emoji} ${c.description} · ${c.temperature}°F (feels like ${c.feelsLike}°F)\n`;
              weatherText += `Humidity: ${c.humidity}% · Wind: ${c.windSpeed} mph (gusts ${c.windGusts} mph)\n`;
              if (w.forecast?.length) {
                weatherText += `\n7-day forecast:\n`;
                for (const d of w.forecast) {
                  weatherText += `  ${d.date}: ${d.emoji} ${d.description} · High ${d.high}°F / Low ${d.low}°F · ${d.precipChance}% precip · Wind ${d.windMax} mph\n`;
                }
              }
              cmdResults.push(weatherText);
            } else {
              cmdResults.push(`Weather lookup failed for "${cmd.location}": ${w.error || "unknown error"}`);
            }
          } catch (e) {
            cmdResults.push(`Weather error: ${e.message}`);
          }
        } else if (cmd.action === "search_web" && cmd.query) {
          const searchText = await tavilySearch(cmd.query, 8);
          if (searchText) {
            cmdResults.push(`Search results for "${cmd.query}":\n${searchText}`);
          } else {
            cmdResults.push(`Search for "${cmd.query}" returned no results`);
          }
        } else if (cmd.action === "open_search" && cmd.query) {
          clientActions.push({
            action: "open_url",
            url: `https://www.google.com/search?q=${encodeURIComponent(cmd.query)}`,
          });
        } else if (cmd.action === "computer_use" && cmd.goal) {
          const agentStore = getStore("darvis-agent");
          await agentStore.setJSON("pending_goal", { goal: cmd.goal, ts: Date.now() });
          await agentStore.setJSON("status", { active: true, goal: cmd.goal, step: 0, thinking: "Waiting for terminal agent...", actions: [], done: false });
          clientActions.push({ action: "agent_started", goal: cmd.goal });
        } else if (cmd.action === "schedule" && cmd.task) {
          const schedStore = getStore("darvis-scheduler");
          let tasks = [];
          try { const d = await schedStore.get("tasks", { type: "json" }); if (Array.isArray(d)) tasks = d; } catch {}
          const executeAt = cmd.delay_minutes
            ? new Date(Date.now() + cmd.delay_minutes * 60000).toISOString()
            : cmd.at || new Date(Date.now() + 60000).toISOString();
          tasks.push({ id: Math.random().toString(36).slice(2, 10), task: cmd.task, execute_at: executeAt, recurring: cmd.recurring_minutes || null, created: new Date().toISOString() });
          await schedStore.setJSON("tasks", tasks);
          clientActions.push({ action: "scheduled", task: cmd.task, at: executeAt, goal: cmd.task });
        } else if (cmd.action === "alert_add" && cmd.type) {
          const alertStore = getStore("darvis-alerts");
          let alerts = [];
          try { const d = await alertStore.get("all", { type: "json" }); if (Array.isArray(d)) alerts = d; } catch {}
          const id = Math.random().toString(36).slice(2, 10);
          alerts.push({ id, type: cmd.type, config: cmd.config || {}, active: true });
          await alertStore.setJSON("all", alerts);
          cmdResults.push(`Alert set: ${cmd.type} — ${JSON.stringify(cmd.config || {})}`);
        } else if (cmd.action === "macro_add" && cmd.name) {
          const macroStore = getStore("darvis-macros");
          let macros = {};
          try { const d = await macroStore.get("all", { type: "json" }); if (d) macros = d; } catch {}
          macros[cmd.name.toLowerCase()] = cmd.command || "";
          await macroStore.setJSON("all", macros);
          cmdResults.push(`Macro saved: ${cmd.name}`);
        } else if (cmd.action === "wiki_ingest" && cmd.content) {
          // Store raw source
          const sourceId = `src-${Date.now()}`;
          await wikiStore.set(`source-raw:${sourceId}`, cmd.content);
          await wikiStore.setJSON(`source:${sourceId}`, {
            id: sourceId, title: cmd.title || "Untitled", type: "paste",
            ingested: new Date().toISOString(), size: cmd.content.length, pages_updated: [],
          });
          // Update index sources
          let wIdx = wikiIndexData || { pages: {}, sources: {} };
          wIdx.sources = wIdx.sources || {};
          wIdx.sources[sourceId] = { title: cmd.title || "Untitled", ingested: new Date().toISOString(), pages_updated: [] };

          // Ask LLM to process into wiki pages
          const schema = await wikiStore.get("schema", { type: "json" }).catch(() => null);
          const instructions = schema?.instructions || "Extract entities and concepts, create wiki pages.";
          const ingestPrompt = `You are a wiki maintainer. Process this source into wiki pages.

CURRENT WIKI INDEX:
${JSON.stringify(wIdx, null, 2)}

WIKI RULES:
${instructions}

SOURCE (${cmd.title || "Untitled"}):
${cmd.content.substring(0, 30000)}

Output ONLY JSON: {"pages": [{"id": "type-slug", "title": "...", "type": "entity|concept|summary", "content": "markdown...", "tags": [...], "links": [...], "summary": "one line"}]}`;

          try {
            const wikiRes = await fetch("https://ollama.com/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
              body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: ingestPrompt }], stream: false }),
              signal: AbortSignal.timeout(90000),
            });
            if (wikiRes.ok) {
              const wikiData = await wikiRes.json();
              const wikiText = wikiData.message?.content || "";
              const jsonMatch = wikiText.match(/\{[\s\S]*"pages"[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const pages = parsed.pages || [];
                const now = new Date().toISOString();
                for (const p of pages) {
                  if (!p.id || !p.title || !p.content) continue;
                  p.type = p.type || "concept";
                  p.tags = p.tags || [];
                  p.links = p.links || [];
                  p.sources = [sourceId];
                  p.created = now;
                  p.updated = now;
                  await wikiStore.setJSON(`page:${p.id}`, p);
                  wIdx.pages[p.id] = {
                    title: p.title, type: p.type, tags: p.tags,
                    summary: p.summary || p.content.substring(0, 120).replace(/[#\n]/g, " ").trim(),
                    updated: now,
                  };
                }
                wIdx.sources[sourceId].pages_updated = pages.map(p => p.id);
                await wikiStore.setJSON("index", wIdx);
                cmdResults.push(`Wiki updated: ${pages.length} pages created/updated from "${cmd.title || "Untitled"}"`);
              }
            }
          } catch (e) {
            cmdResults.push(`Wiki ingest error: ${e.message}`);
          }
        }
      } catch {}
    }

    // Force browse if needed
    const hasAgentAction = clientActions.some((a) => a.action === "agent_started");
    if (!hasAgentAction && needsBrowse(message)) {
      const agentStore = getStore("darvis-agent");
      await agentStore.setJSON("pending_goal", { goal: message, ts: Date.now() });
      await agentStore.setJSON("status", { active: true, goal: message, step: 0, thinking: "Waiting for terminal agent...", actions: [], done: false });
      clientActions.push({ action: "agent_started", goal: message });
    }

    // Clean command blocks from visible reply
    reply = reply.replace(/```command\s*\n?[\s\S]*?\n?```/g, "").trim();

    // If commands produced results, make a follow-up LLM call with the data
    let followUp = null;
    if (cmdResults.length > 0) {
      try {
        const followUpRes = await fetch("https://ollama.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: "system", content: `You are the user's personal AI assistant. NEVER say "Spectra" or your name. NEVER describe your personality. Address the user as "sir". ${timeBlock}\nThe user asked: "${message}"\nYou already told them: "${reply || 'Looking into it'}"\nNow give the ACTUAL answer using the results below. Be thorough — include specific facts, numbers, names, dates. Do not repeat what you already said. Just deliver the information.` },
              { role: "user", content: `Results:\n${cmdResults.join("\n\n")}` },
            ],
            stream: false,
          }),
          signal: AbortSignal.timeout(60000),
        });
        if (followUpRes.ok) {
          const fData = await followUpRes.json();
          const fText = (fData.message?.content || "").replace(/```command[\s\S]*?```/g, "").trim();
          if (fText) {
            if (!reply) {
              // LLM gave no initial text, just use the follow-up as the reply
              reply = fText;
            } else {
              // LLM gave initial text ("Looking that up...") — send follow-up as second message
              followUp = fText;
            }
          }
        }
      } catch {}
    }

    // If still no reply, build from actions
    if (!reply && (clientActions.length > 0 || cmdResults.length > 0)) {
      const parts = [];
      if (cmdResults.length > 0) parts.push(cmdResults.join("\n").substring(0, 2000));
      for (const a of clientActions) {
        if (a.action === "scheduled") parts.push(`Scheduled: ${a.task}`);
        else if (a.action === "queued") parts.push(a.message);
        else if (a.action === "open_url") parts.push(`Opening ${a.url}`);
        else if (a.action === "agent_started") parts.push(`Browser agent launched: ${a.goal}`);
      }
      reply = parts.join("\n") || "Done, sir.";
    }

    if (!reply) reply = "Done, sir.";

    // Save history (include follow-up as the substantive answer)
    try {
      history.push(userMsg);
      history.push({ role: "assistant", content: followUp ? `${reply}\n\n${followUp}` : reply });
      if (history.length > 40) history = history.slice(-40);
      await historyStore.setJSON("conversation", history);
    } catch {}

    const response = { reply };
    if (followUp) response.followUp = followUp;
    if (clientActions.length > 0) response.actions = clientActions;
    return Response.json(response);
  } catch (err) {
    return Response.json(
      { reply: `Connection error: ${err.message}` },
      { status: 200 }
    );
  }
};

export const config = { path: "/api/chat" };
