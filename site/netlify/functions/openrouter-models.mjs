import { getStore } from "@netlify/blobs";

// Returns the list of available OpenRouter models so the frontend can
// populate a dropdown. Cached for 1 hour in Netlify Blobs.
//
// GET /api/openrouter/models
// POST /api/openrouter/set-model { model }

const CACHE_MS = 60 * 60 * 1000;

export default async (req) => {
  const KEY = Netlify.env.get("OPENROUTER_API_KEY");
  if (!KEY) return Response.json({ error: "OPENROUTER_API_KEY not set" }, { status: 503 });

  // POST — save the user's chosen model
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body.model) {
      const store = getStore("darvis-settings");
      try {
        const s = (await store.get("current", { type: "json" })) || {};
        s.openrouter_model = body.model;
        await store.setJSON("current", s);
      } catch (e) {}
      return Response.json({ ok: true, model: body.model });
    }
    return Response.json({ error: "no model" }, { status: 400 });
  }

  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  // Check cache
  const store = getStore("darvis-falcon-eye");
  try {
    const cached = await store.get("openrouter-models", { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch (e) {}

  // Fetch from OpenRouter
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { "Authorization": `Bearer ${KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return Response.json({ models: [], error: `openrouter ${res.status}` });
    const data = await res.json();

    // Parse and organize models by provider
    const models = (data.data || [])
      .filter((m) => m.id && m.name)
      .map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.id.split("/")[0] || "unknown",
        context: m.context_length || 0,
        pricing: m.pricing ? {
          prompt: m.pricing.prompt,
          completion: m.pricing.completion,
        } : null,
        isFree: m.pricing?.prompt === "0" || m.pricing?.prompt === 0,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    // Get current model setting
    let current = "anthropic/claude-sonnet-4";
    try {
      const settings = getStore("darvis-settings");
      const s = await settings.get("current", { type: "json" });
      if (s?.openrouter_model) current = s.openrouter_model;
    } catch (e) {}

    const out = { models, current, total: models.length, ts: Date.now() };
    try { await store.setJSON("openrouter-models", { data: out, ts: Date.now() }); } catch (e) {}
    return Response.json(out);
  } catch (e) {
    return Response.json({ models: [], error: e?.message || "fetch failed" });
  }
};

export const config = { path: ["/api/openrouter/models", "/api/openrouter/set-model"] };
