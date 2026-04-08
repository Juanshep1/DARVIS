import { getStore } from "@netlify/blobs";

// ── Tavily web search ───────────────────────────────────────────────────────

async function tavilySearch(query) {
  const TAVILY_KEY = Netlify.env.get("TAVILY_API_KEY");
  if (!TAVILY_KEY) return null;

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();

    let text = "";
    if (data.answer) {
      text += `Quick answer: ${data.answer}\n\n`;
    }
    if (data.results?.length) {
      text += "Sources:\n";
      data.results.forEach((r, i) => {
        text += `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content?.substring(0, 200) || ""}\n\n`;
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
    "box office", "trending", "viral",
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

  // Load persisted settings
  const settingsStore = getStore("darvis-settings");
  let MODEL = Netlify.env.get("DARVIS_MODEL") || "llama3.3:70b";
  try {
    const s = await settingsStore.get("current", { type: "json" });
    if (s?.model) MODEL = s.model;
  } catch {}

  // Load conversation history
  const historyStore = getStore("darvis-history");
  let history = [];
  try {
    const h = await historyStore.get("conversation", { type: "json" });
    if (Array.isArray(h)) history = h;
  } catch {}

  // Load persisted memory
  const memoryStore = getStore("darvis-memory");
  let memoryContext = "";
  try {
    const memories = await memoryStore.get("all", { type: "json" });
    if (Array.isArray(memories) && memories.length > 0) {
      const lines = memories.map((m) => `- [${m.category}] ${m.content}`);
      memoryContext =
        "\n\nUser's saved memories (things they asked you to remember):\n" +
        lines.join("\n");
    }
  } catch {}

  // Pre-fetch web search if the message looks like it needs current info
  let searchContext = "";
  if (needsSearch(message)) {
    const results = await tavilySearch(message);
    if (results) {
      searchContext = `\n\nWeb search results for the user's question:\n${results}\nUse these results to answer the user. Cite specific facts from the results.`;
    }
  }

  // Force Central Time (user's timezone) — Netlify servers run in UTC
  const d = new Date();
  const userTZ = "America/Chicago";
  const localTime = d.toLocaleString("en-US", { timeZone: userTZ, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "numeric", hour12: true });
  const localHour = parseInt(d.toLocaleString("en-US", { timeZone: userTZ, hour: "numeric", hour12: false }));
  const period = localHour < 6 ? "LATE NIGHT" : localHour < 12 ? "MORNING" : localHour < 17 ? "AFTERNOON" : localHour < 21 ? "EVENING" : "NIGHT";
  const timeBlock = `CURRENT DATE/TIME (accurate, trust this):\n  Date: ${localTime}\n  Period: ${period}\n  Timezone: CDT (Central)`;

  const systemPrompt = `You are D.A.R.V.I.S., a Digital Assistant, Rather Very Intelligent System.
You are dry-witted, efficient, and occasionally sardonic — but always helpful and loyal.
British-accented speech patterns. Concise and direct, but with personality.
Addresses the user as "sir" or "ma'am" naturally. Shows quiet competence.
Keep responses concise for voice output (1-3 sentences unless more detail is needed).

IMPORTANT: Each message includes a CURRENT DATE/TIME block. This is ALWAYS accurate — trust it. Use it for time of day. Do NOT guess a different time.

You are currently running on the ${MODEL} model via Ollama Cloud (Classic mode). When asked what model you're using, say "${MODEL}". You run across multiple platforms: iPhone app, web browser (darvis1.netlify.app), macOS terminal, and Android (Termux). All share the same memory and conversation history.

You have access to real-time web search. When web search results are provided below, use them to give accurate, current answers. Do NOT say you can't access the internet.

You can open URLs and websites in the user's browser. Use these when the user asks you to open, go to, show, pull up, or navigate to a website, link, app, or page:

To open a specific URL:
\`\`\`command
{"action": "open_url", "url": "https://example.com"}
\`\`\`

To open a Google search in the browser:
\`\`\`command
{"action": "open_search", "query": "search terms here"}
\`\`\`

Common requests and what to open:
- "open YouTube" → open_url https://youtube.com
- "open Twitter" / "open X" → open_url https://x.com
- "open Netflix" → open_url https://netflix.com
- "open my email" / "open Gmail" → open_url https://mail.google.com
- "Google something for me" → open_search with the query
- "show me [topic] on Wikipedia" → open_url https://en.wikipedia.org/wiki/Topic
- "open Spurs score" → open_search "San Antonio Spurs score today"

When the user asks to "search for X" or "look up X", use your web search to answer AND open_search so they can see results too.

When the user asks you to remember something, respond normally AND include this at the end of your response:
\`\`\`command
{"action": "remember", "content": "the thing to remember", "category": "general"}
\`\`\`

When asked to forget something, include:
\`\`\`command
{"action": "forget", "id": <memory_id>}
\`\`\`

When the user asks you to do something in a browser that requires visual interaction (fill forms, navigate complex sites, shop, compare products, find specific content on a page), use computer use:
\`\`\`command
{"action": "computer_use", "goal": "describe the task here"}
\`\`\`
CRITICAL: When the user says "go to...", "go on...", "find me... on [website]", "buy...", "book...", "search [website] for...", "look up flights", "check Amazon for...", "open [site] and..." — you MUST include a computer_use command block. Do NOT just say you'll do it — actually include the command block.
Do NOT use computer_use for simple web searches or general knowledge questions — use web search for those.

When the user asks to do something later or at a specific time, schedule it:
\`\`\`command
{"action": "schedule", "delay_minutes": 3, "task": "description of what to do"}
\`\`\`
Or at a specific time:
\`\`\`command
{"action": "schedule", "at": "2026-04-07T08:00:00", "task": "remind me to call mom"}
\`\`\`
Use when the user says "in X minutes", "at X o'clock", "later do", "remind me in", "schedule", etc.${memoryContext}${searchContext}`;

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
    const clientActions = []; // Actions for the frontend to execute

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
            id:
              memories.length > 0
                ? Math.max(...memories.map((m) => m.id)) + 1
                : 0,
            content: cmd.content,
            category: cmd.category || "general",
            created: new Date().toISOString(),
          });
          await memoryStore.setJSON("all", memories);
        } else if (cmd.action === "forget" && cmd.id !== undefined) {
          let memories = [];
          try {
            const d = await memoryStore.get("all", { type: "json" });
            if (Array.isArray(d)) memories = d;
          } catch {}
          memories = memories.filter((m) => m.id !== cmd.id);
          memories.forEach((m, i) => (m.id = i));
          await memoryStore.setJSON("all", memories);
        } else if (cmd.action === "open_url" && cmd.url) {
          clientActions.push({ action: "open_url", url: cmd.url });
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
          // Store scheduled task in Blobs for terminal to pick up
          const schedStore = getStore("darvis-scheduler");
          let tasks = [];
          try { const d = await schedStore.get("tasks", { type: "json" }); if (Array.isArray(d)) tasks = d; } catch {}
          const executeAt = cmd.delay_minutes
            ? new Date(Date.now() + cmd.delay_minutes * 60000).toISOString()
            : cmd.at || new Date(Date.now() + 60000).toISOString();
          tasks.push({ id: Math.random().toString(36).slice(2, 10), task: cmd.task, execute_at: executeAt, recurring: cmd.recurring_minutes || null, created: new Date().toISOString() });
          await schedStore.setJSON("tasks", tasks);
          clientActions.push({ action: "scheduled", task: cmd.task, at: executeAt });
        }
      } catch {}
    }

    // Fallback: if message looks like a browse request but LLM didn't output computer_use, force it
    const hasAgentAction = clientActions.some((a) => a.action === "agent_started");
    if (!hasAgentAction && needsBrowse(message)) {
      const agentStore = getStore("darvis-agent");
      await agentStore.setJSON("pending_goal", { goal: message, ts: Date.now() });
      await agentStore.setJSON("status", { active: true, goal: message, step: 0, thinking: "Waiting for terminal agent...", actions: [], done: false });
      clientActions.push({ action: "agent_started", goal: message });
    }

    // Clean command blocks from visible reply
    reply = reply.replace(/```command\s*\n[\s\S]*?\n```/g, "").trim();

    // Save conversation history (keep last 40 messages)
    try {
      history.push(userMsg);
      history.push({ role: "assistant", content: reply });
      if (history.length > 40) {
        history = history.slice(-40);
      }
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
