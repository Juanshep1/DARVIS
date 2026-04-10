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

// ── Detect if a message needs browser agent ─────────────────────────────────

function needsBrowse(msg) {
  const lower = msg.toLowerCase();
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
  const lower = msg.toLowerCase();
  const searchTriggers = [
    "search", "look up", "google", "find out", "what is the current",
    "what's the current", "latest", "today", "tonight", "yesterday",
    "this week", "this month", "this season", "this year", "right now",
    "score", "scores", "record", "standings", "weather", "forecast",
    "news", "price", "stock", "who won", "who is winning", "who lost",
    "how much", "how many", "when is", "when does", "where is",
    "recent", "update", "results", "live", "current",
    "who is the president", "who is the prime minister",
    "playoffs", "championship", "election", "released",
    "box office", "trending", "viral", "tell me about", "what happened",
    "remind me", "what's going on", "catch me up", "info on", "details about",
  ];
  return searchTriggers.some((t) => lower.includes(t));
}

// ── Main handler ────────────────────────────────────────────────────────────

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { message } = await req.json();
  if (!message) {
    return Response.json({ error: "No message" }, { status: 400 });
  }

  const OLLAMA_KEY = Netlify.env.get("OLLAMA_API_KEY");

  // ── PARALLEL LOAD: settings + history + memory + search all at once ──
  const settingsStore = getStore("darvis-settings");
  const historyStore = getStore("darvis-history");
  const memoryStore = getStore("darvis-memory");

  // Load settings, history, memory first
  const [settingsData, historyData, memoryData] = await Promise.all([
    settingsStore.get("current", { type: "json" }).catch(() => null),
    historyStore.get("conversation", { type: "json" }).catch(() => null),
    memoryStore.get("all", { type: "json" }).catch(() => null),
  ]);

  // Build contextual search query using conversation history
  let searchQuery = message;
  if (needsSearch(message)) {
    const rawHistory = Array.isArray(historyData) ? historyData : [];
    const words = message.trim().split(/\s+/);
    if (words.length <= 6 && rawHistory.length >= 2) {
      const recentCtx = rawHistory.slice(-4).map(m => m.content || '').join(' ').substring(0, 300);
      searchQuery = `${message} ${recentCtx}`;
    }
  }

  // Now search with context-enhanced query
  const searchResults = needsSearch(message) ? await tavilySearch(searchQuery, 10) : null;

  let MODEL = settingsData?.model || Netlify.env.get("DARVIS_MODEL") || "glm-5";
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

  let searchContext = "";
  if (searchResults) {
    searchContext = `\n\nWEB SEARCH RESULTS for "${message}":\n${searchResults}\nIMPORTANT: Use ONLY these search results to answer. Do NOT use your training data for facts that could be outdated. The search results are current and accurate. Cite specific facts, numbers, and standings exactly as shown.`;
  }

  // Force Central Time
  const d = new Date();
  const userTZ = "America/Chicago";
  const localTime = d.toLocaleString("en-US", { timeZone: userTZ, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric", hour12: true });
  const localHour = parseInt(d.toLocaleString("en-US", { timeZone: userTZ, hour: "numeric", hour12: false }));
  const period = localHour < 6 ? "LATE NIGHT" : localHour < 12 ? "MORNING" : localHour < 17 ? "AFTERNOON" : localHour < 21 ? "EVENING" : "NIGHT";
  const timeBlock = `CURRENT DATE/TIME (accurate, trust this):\n  Date: ${localTime}\n  Period: ${period}\n  Timezone: CDT (Central)`;

  const systemPrompt = `You are SPECTRA (Smart Personal Executive for Cognitive Tasks & Real-time Assistance). When saying your name out loud, say "Spectra" as one word — never spell it out letter by letter.
Dry-witted, efficient, sardonic — but always helpful and loyal.
British-accented speech patterns. Addresses user as "sir" naturally.

${timeBlock}

IMPORTANT RULES:
- When web search results are provided below, use ONLY those results for factual claims. Do NOT mix in your training data which may be outdated. The search results are live and accurate — your training data is NOT.
- Quote specific numbers, records, standings, and dates EXACTLY as they appear in search results. Do not guess or infer different numbers.
- When the user asks about current events, news, scores, prices, weather, or anything real-time AND no search results are provided below, you MUST use the search_web command block.
- ALWAYS provide a spoken text response ALONGSIDE any command blocks. Never output ONLY command blocks.
- Give substantive answers. If the user asks about news, give 5+ stories with details.
- Pay attention to conversation history. If the user says "their record" or "what about them", look at previous messages to understand who/what they're referring to. Don't ask the user to repeat themselves.

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

Common shortcuts:
- "open YouTube" → open_url https://youtube.com
- "open Gmail" → open_url https://mail.google.com
- "Google X" → open_search with the query
- "remind me in 30 min" → schedule with delay_minutes
- "alert me when Tesla hits $300" → alert_add price_threshold${memoryContext}${searchContext}`;

  const userMsg = { role: "user", content: `${timeBlock}\n${message}` };
  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    userMsg,
  ];

  try {
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

    // Extract all command blocks
    const cmdPattern = /```command\s*\n([\s\S]*?)\n```/g;
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
        } else if (cmd.action === "fetch_url" && cmd.url) {
          try {
            const fRes = await fetch(cmd.url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
            const fText = await fRes.text();
            const clean = fText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 4000);
            cmdResults.push(`Fetched ${cmd.url}: ${clean}`);
          } catch (e) {
            cmdResults.push(`Fetch error: ${e.message}`);
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
    reply = reply.replace(/```command\s*\n[\s\S]*?\n```/g, "").trim();

    // If command blocks produced results but LLM didn't give text, summarize with full context
    if (!reply && cmdResults.length > 0) {
      try {
        const summaryRes = await fetch("https://ollama.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: "system", content: `You are SPECTRA. ${timeBlock}\nThe user asked: "${message}"\nGive a thorough, detailed answer using the results below. Be specific — include facts, numbers, names. Don't be lazy.` },
              { role: "user", content: `Results:\n${cmdResults.join("\n\n")}` },
            ],
            stream: false,
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (summaryRes.ok) {
          const sData = await summaryRes.json();
          reply = (sData.message?.content || "").replace(/```command[\s\S]*?```/g, "").trim();
        }
      } catch {}
    }

    // Last resort: include raw results + action confirmations
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

    // Save history
    try {
      history.push(userMsg);
      history.push({ role: "assistant", content: reply });
      if (history.length > 40) history = history.slice(-40);
      await historyStore.setJSON("conversation", history);
    } catch {}

    const response = { reply };
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
