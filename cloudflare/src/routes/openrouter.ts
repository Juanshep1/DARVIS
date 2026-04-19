import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON, kvSetJSON } from "../lib/kv";
import { buildTimeBlock } from "../lib/time";

const MODELS_CACHE_MS = 60 * 60 * 1000;

// ── /api/openrouter/chat ──────────────────────────────────────────────────
export const openrouterChatRoute = new Hono<{ Bindings: Env }>();

interface Msg { role: string; content: string }

openrouterChatRoute.post("/", async (c) => {
  const KEY = c.env.OPENROUTER_API_KEY;
  if (!KEY) return c.json({ error: "OPENROUTER_API_KEY not set" }, 503);

  const body = await c.req.json<{ message?: string; model?: string; tz?: string }>().catch(() => ({} as { message?: string; model?: string; tz?: string }));
  if (!body.message) return c.json({ error: "no message" }, 400);

  let model = body.model || "anthropic/claude-sonnet-4";
  const settings = await kvGetJSON<{ openrouter_model?: string }>(c.env, "settings", "current");
  if (settings?.openrouter_model) model = settings.openrouter_model;
  if (body.model) model = body.model;

  const mems = (await kvGetJSON<{ content: string; category?: string }[]>(c.env, "memory", "all")) || [];
  const memoryContext = mems.length
    ? "\n\nUser's saved memories:\n" + mems.map((m) => `- ${m.content}`).join("\n")
    : "";

  let history: Msg[] = (await kvGetJSON<Msg[]>(c.env, "history", "conversation")) || [];
  history = history.slice(-20);

  const timeBlock = buildTimeBlock(body.tz);

  // Weather pre-fetch
  let weatherContext = "";
  const lmsg = body.message.toLowerCase();
  const wxTriggers = ["weather", "forecast", "temperature", "rain", "snow", "wind", "humidity", "outside", "cold", "hot", "warm", "storm", "sunny", "cloudy"];
  if (wxTriggers.some((t) => lmsg.includes(t))) {
    let city = "";
    const m1 = lmsg.match(/(?:weather|forecast|temperature|rain|snow|wind|storm)\s+(?:in|for|at|near)\s+([a-zA-Z\s,]+?)(?:\?|$|\.|\!)/i);
    if (m1) city = m1[1].trim();
    if (!city) {
      const m2 = body.message.match(/(?:in|for|at|near)\s+([A-Z][a-zA-Z\s,]+?)(?:\?|$|\.|\!)/);
      if (m2) city = m2[1].trim();
    }
    if (!city) city = "Dallas";
    try {
      const origin = new URL(c.req.url).origin;
      const wr = await fetch(`${origin}/api/weather?q=${encodeURIComponent(city)}`, { signal: AbortSignal.timeout(8000) });
      const w = (await wr.json()) as { current?: { emoji?: string; description?: string; temperature?: number; feelsLike?: number; humidity?: number; windSpeed?: number }; location?: string; forecast?: { date: string; emoji?: string; description?: string; high?: number; low?: number; precipChance?: number }[] };
      if (w.current) {
        const cur = w.current;
        weatherContext = `\n\nREAL-TIME WEATHER (just fetched — use directly):\nLocation: ${w.location}\n`;
        weatherContext += `Current: ${cur.emoji} ${cur.description} · ${cur.temperature}°F (feels ${cur.feelsLike}°F) · Humidity ${cur.humidity}% · Wind ${cur.windSpeed} mph\n`;
        if (w.forecast?.length) {
          weatherContext += `Forecast:\n`;
          for (const d of w.forecast) weatherContext += `  ${d.date}: ${d.emoji} ${d.description} · High ${d.high}°F / Low ${d.low}°F · ${d.precipChance}% precip\n`;
        }
      }
    } catch {}
  }

  const systemPrompt = `You are the user's personal AI assistant. Be helpful, loyal, and concise.
Respond with subtle wit and a British tone — but NEVER describe your own personality traits.
NEVER say "Spectra" or any name for yourself unless directly asked "who are you?".
Address the user as "sir" (the user is male).
${timeBlock}
You are running via OpenRouter on model: ${model}.

CRITICAL RULES:
- You HAVE conversation history. There are ${history.length} prior messages loaded below. USE THEM.
- NEVER say "I don't have access to previous conversations" — the history is right here.
- Start with the answer, skip throat-clearing.
- WEATHER: if data is provided below, use it directly.${memoryContext}${weatherContext}`;

  const messages: Msg[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: body.message },
  ];

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/Juanshep1/DARVIS",
        "X-Title": "Spectra",
      },
      body: JSON.stringify({ model, messages, max_tokens: 2048, temperature: 0.7 }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return c.json({ reply: `OpenRouter error (${res.status}): ${errText.slice(0, 200)}`, actions: [] });
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
    const reply = data.choices?.[0]?.message?.content || "No response from OpenRouter.";
    const usage = data.usage || {};

    history.push({ role: "user", content: body.message });
    history.push({ role: "assistant", content: reply });
    if (history.length > 40) history = history.slice(-40);
    await kvSetJSON(c.env, "history", "conversation", history);

    return c.json({
      reply,
      model: data.model || model,
      usage: { prompt: usage.prompt_tokens, completion: usage.completion_tokens },
      actions: [],
    });
  } catch (e) {
    return c.json({ reply: `OpenRouter request failed: ${(e as Error).message}`, actions: [] });
  }
});

// ── /api/openrouter/models ────────────────────────────────────────────────
export const openrouterModelsRoute = new Hono<{ Bindings: Env }>();

openrouterModelsRoute.get("/", async (c) => {
  const KEY = c.env.OPENROUTER_API_KEY;
  if (!KEY) return c.json({ error: "OPENROUTER_API_KEY not set" }, 503);

  const cached = await kvGetJSON<{ data: unknown; ts: number }>(c.env, "falcon-eye", "openrouter-models");
  if (cached && Date.now() - cached.ts < MODELS_CACHE_MS) {
    return new Response(JSON.stringify(cached.data), { headers: { "Content-Type": "application/json", "X-Cache": "HIT" } });
  }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return c.json({ models: [], error: `openrouter ${res.status}` });
    const data = (await res.json()) as { data?: { id: string; name: string; context_length?: number; pricing?: { prompt: string | number; completion: string | number } }[] };
    const models = (data.data || [])
      .filter((m) => m.id && m.name)
      .map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.id.split("/")[0] || "unknown",
        context: m.context_length || 0,
        pricing: m.pricing ? { prompt: m.pricing.prompt, completion: m.pricing.completion } : null,
        isFree: m.pricing?.prompt === "0" || m.pricing?.prompt === 0,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    let current = "anthropic/claude-sonnet-4";
    const settings = await kvGetJSON<{ openrouter_model?: string }>(c.env, "settings", "current");
    if (settings?.openrouter_model) current = settings.openrouter_model;

    const out = { models, current, total: models.length, ts: Date.now() };
    await kvSetJSON(c.env, "falcon-eye", "openrouter-models", { data: out, ts: Date.now() });
    return c.json(out);
  } catch (e) {
    return c.json({ models: [], error: (e as Error).message });
  }
});

// ── /api/openrouter/set-model ─────────────────────────────────────────────
export const openrouterSetModelRoute = new Hono<{ Bindings: Env }>();

openrouterSetModelRoute.post("/", async (c) => {
  const body = await c.req.json<{ model?: string }>().catch(() => ({} as { model?: string }));
  if (!body.model) return c.json({ error: "no model" }, 400);
  const settings = (await kvGetJSON<{ openrouter_model?: string }>(c.env, "settings", "current")) || {};
  settings.openrouter_model = body.model;
  await kvSetJSON(c.env, "settings", "current", settings);
  return c.json({ ok: true, model: body.model });
});
