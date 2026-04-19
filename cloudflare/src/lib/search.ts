import type { Env } from "../env";

// ── Tavily web search ──────────────────────────────────────────────────────
export async function tavilySearch(env: Env, query: string, maxResults = 8): Promise<string | null> {
  const key = env.TAVILY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "advanced",
        max_results: maxResults,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { answer?: string; results?: { title?: string; url?: string; content?: string }[] };
    let text = "";
    if (data.answer) text += `Answer: ${data.answer}\n\n`;
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

// ── needsSearch — mirrors the browser/iOS heuristic ───────────────────────
export function needsSearch(msg: string): boolean {
  const lower = msg.toLowerCase().trim();
  if (!lower) return false;

  const chatter: RegExp[] = [
    /^(hi|hey|hello|yo|sup|good (morning|afternoon|evening|night))\b/,
    /^(thanks|thank you|thx|cheers|nice|cool|awesome|great|ok|okay|k)\b/,
    /^(are you there|you there|you awake|can you hear me)\b/,
    /^(what can you do|what are you|who are you)\b/,
    /^(shut up|stop|pause|be quiet|nevermind|never mind|cancel)\b/,
    /^(yes|yeah|yep|yup|no|nope|nah|sure|fine|maybe)[\s.!?]*$/,
  ];
  if (chatter.some((re) => re.test(lower))) return false;

  const nonSearchActions: RegExp[] = [
    /^(open|launch|start|close|quit|kill)\s/,
    /^(create|write|make|save|generate)\s.*(file|folder|document|note|text|script)/,
    /^(play|pause|skip|resume|next|previous|stop)\b/,
    /^(remember|forget|remind me|set a reminder|set a timer)\b/,
    /^(schedule|set an alert)\b/,
    /^(run |execute |shell )/,
  ];
  if (nonSearchActions.some((re) => re.test(lower))) return false;

  if (/^(who|what|when|where|why|how|which|whose|whom)\b/.test(lower)) return true;
  if (/^(is |are |was |were |do |does |did |has |have |had |can |could |will |would |should |may |might )/.test(lower)) return true;
  if (/\?\s*$/.test(lower)) return true;

  const triggers = [
    "search", "look up", "google", "find out", "find me", "show me", "tell me", "check", "what about",
    "latest", "today", "tonight", "yesterday", "this week", "this month", "this year", "right now",
    "currently", "current", "recent", "recently", "tomorrow", "upcoming", "last night", "last week",
    "last month", "last year", "live ",
    "score", "scores", "standings", "playoffs", "championship", "who won", "who lost", "results", "highlights",
    "game", "match", "final", "season", "trade", "signed",
    "news", "headline", "breaking", "update", "weather", "forecast", "temperature",
    "price", "stock", "crypto", "bitcoin", "ethereum", "market", "shares", "index", "earnings",
    "inflation", "fed", "dow", "nasdaq",
    "president", "prime minister", "ceo", "founder", "owner", "senator", "governor", "mayor",
    "how much", "how many", "how old", "when is", "when does", "when did", "where is", "where does",
    "how long", "how far", "how tall",
    "tell me about", "what happened", "catch me up", "info on", "details about", "background on",
    "history of", "biography", "bio of", "summary of",
    "wiki", "wikipedia", "encyclopedia", "define", "definition",
    "trending", "viral", "released", "box office", "top 10", "best ",
    "near me", "hours of", "phone number", "address of", "directions",
  ];
  return triggers.some((t) => lower.includes(t));
}

export function isAmbiguousFollowup(msg: string, historyLen: number): boolean {
  if (historyLen < 2) return false;
  const lower = msg.toLowerCase().trim();
  if (/\b(it|its|that|this|they|them|those|these|there|their|he|she|his|her|him)\b/.test(lower)) return true;
  if (/\b(till|until|by then|since then|what about|how about|and (you|then)|more about|same|also|too|instead)\b/.test(lower)) return true;
  if (msg.trim().split(/\s+/).length <= 5) return true;
  return false;
}

// ── Gemini-backed query rewrite for ambiguous follow-ups ──────────────────
export async function rewriteSearchQuery(env: Env, msg: string, history: { role?: string; content?: string }[]): Promise<string | null> {
  const key = env.GEMINI_API_KEY;
  if (!key) return null;
  const last = (history || []).slice(-6).filter((m) => m?.role && m?.content);
  if (last.length < 2) return null;
  const ctx = last.map((m) => `${m.role === "assistant" ? "assistant" : "user"}: ${String(m.content).substring(0, 400)}`).join("\n");
  const prompt = `Rewrite the user's latest message into a standalone web search query. Expand pronouns ("it", "that", "they", "there") using the conversation. Keep proper nouns, dates, and numbers. If the latest message already stands alone, return it unchanged. Output ONLY the rewritten query on a single line — no quotes, no explanation.\n\nConversation:\n${ctx}\n\nLatest message: ${msg}\n\nStandalone search query:`;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
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
    const d = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    let rewritten = d.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
    if (!rewritten) return null;
    rewritten = rewritten.replace(/^["'`]+|["'`]+$/g, "").split("\n")[0].trim();
    if (rewritten.length < 2 || rewritten.length > 300) return null;
    if (rewritten.toLowerCase() === msg.toLowerCase().trim()) return null;
    return rewritten;
  } catch {
    return null;
  }
}
