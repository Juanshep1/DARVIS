import { getStore } from "@netlify/blobs";

// OpenRouter chat endpoint — routes to any model on OpenRouter's catalog
// (Claude, GPT-4o, Gemini, Llama, Mistral, DeepSeek, Command R+, etc.)
// with the same system prompt + memory + history that classic mode uses.
//
// POST /api/openrouter/chat { message, model? }

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const KEY = Netlify.env.get("OPENROUTER_API_KEY");
  if (!KEY) return Response.json({ error: "OPENROUTER_API_KEY not set" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const message = body.message;
  if (!message) return Response.json({ error: "no message" }, { status: 400 });

  // Default model — Claude 3.5 Sonnet is a good all-rounder on OpenRouter
  let model = body.model || "anthropic/claude-sonnet-4";

  // Load settings for the user's chosen OpenRouter model
  const settingsStore = getStore("darvis-settings");
  try {
    const s = await settingsStore.get("current", { type: "json" });
    if (s?.openrouter_model) model = s.openrouter_model;
  } catch (e) {}
  // Per-request model override takes priority
  if (body.model) model = body.model;

  // Load memories for context
  const memoryStore = getStore("darvis-memory");
  let memoryContext = "";
  try {
    const mems = await memoryStore.get("all", { type: "json" });
    if (Array.isArray(mems) && mems.length) {
      memoryContext = "\n\nUser's saved memories:\n" + mems.map((m) => `- ${m.content}`).join("\n");
    } else if (mems?.memories?.length) {
      memoryContext = "\n\nUser's saved memories:\n" + mems.memories.map((m) => `- ${m.content}`).join("\n");
    }
  } catch (e) {}

  // Load conversation history
  const historyStore = getStore("darvis-history");
  let history = [];
  try {
    const h = await historyStore.get("conversation", { type: "json" });
    if (Array.isArray(h)) history = h.slice(-20); // last 10 exchanges
  } catch (e) {}

  const now = new Date();
  const timeBlock = `Current time: ${now.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "numeric", hour12: true })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;

  const systemPrompt = `You are the user's personal AI assistant. Be helpful, loyal, and concise.
Respond with subtle wit and a British tone — but NEVER describe your own personality traits.
NEVER say "Spectra" or any name for yourself unless directly asked "who are you?".
Address the user as "sir" (the user is male).
${timeBlock}
You are running via OpenRouter on model: ${model}.
Be thorough but fast. Start with the answer, skip throat-clearing.${memoryContext}`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://darvis1.netlify.app",
        "X-Title": "Spectra",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 2048,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return Response.json({ reply: `OpenRouter error (${res.status}): ${errText.slice(0, 200)}`, actions: [] });
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || "No response from OpenRouter.";
    const usage = data.usage || {};

    // Save to shared history
    try {
      history.push({ role: "user", content: message });
      history.push({ role: "assistant", content: reply });
      if (history.length > 40) history = history.slice(-40);
      await historyStore.setJSON("conversation", history);
    } catch (e) {}

    return Response.json({
      reply,
      model: data.model || model,
      usage: { prompt: usage.prompt_tokens, completion: usage.completion_tokens },
      actions: [],
    });
  } catch (e) {
    return Response.json({ reply: `OpenRouter request failed: ${e?.message || e}`, actions: [] });
  }
};

export const config = { path: "/api/openrouter/chat" };
