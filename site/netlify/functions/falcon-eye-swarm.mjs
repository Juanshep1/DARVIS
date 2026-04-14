import { getStore } from "@netlify/blobs";

// Falcon Eye Intel Swarm — LLM-orchestrated intel agents.
//
// Each agent writes its findings to blob key `swarm:<agent>` in the
// `darvis-falcon-eye` store. This endpoint aggregates them and, when
// their cached state is stale, re-runs the agent on-demand (lazy refresh).
//
// GET  /api/falcon-eye/swarm                 → aggregated feed
// GET  /api/falcon-eye/swarm?agent=news      → single agent feed
// POST /api/falcon-eye/swarm  {agent:"news"} → force-run an agent

const AGENT_TTL_MS = 5 * 60_000; // 5 min
// Use a small fast model for classification — the main DARVIS_MODEL (glm-5)
// is too slow to finish inside the 30s Netlify function budget when given
// 25 items to classify. Override with SWARM_MODEL env if needed.
const MODEL = Netlify.env.get("SWARM_MODEL") || "ministral-3:8b";

// ── Shared helpers ─────────────────────────────────────────────────
function stripTags(s) { return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
function decodeEntities(s) {
  return (s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

async function fetchGoogleNewsRSS(query) {
  const u = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const r = await fetch(u, {
      headers: { "User-Agent": "Mozilla/5.0 (FalconEye-Swarm)", Accept: "application/rss+xml, text/xml" },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml))) {
      const block = m[1];
      const getTag = (tag) => {
        const rx = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`);
        return decodeEntities(stripTags(rx.exec(block)?.[1] || ""));
      };
      const title = getTag("title");
      const link = getTag("link");
      const pubDate = getTag("pubDate");
      const description = getTag("description");
      let source = "", headline = title;
      const lastDash = title.lastIndexOf(" - ");
      if (lastDash > 0) {
        source = title.slice(lastDash + 3).trim();
        headline = title.slice(0, lastDash).trim();
      }
      const ts = pubDate ? new Date(pubDate).getTime() : Date.now();
      if (!isNaN(ts)) items.push({ headline, title, link, description, source, ts });
    }
    return items;
  } catch { return []; }
}

function dedupKey(title) {
  return (title || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).slice(0, 6).join(" ");
}

// ── Regex-based classifier (fast, reliable) ────────────────────────
const SEVERITY_RULES = [
  { re: /\b(nuclear (?:strike|weapon|attack)|declared war|invasion launched|carrier strike|WW3|weapons of mass destruction|genocide)\b/i, sev: "critical" },
  { re: /\b(airstrike|air strike|missile (?:strike|attack)|drone strike|invasion|massacre|hostages? (?:killed|taken)|mass casualty|massive explosion)\b/i, sev: "critical" },
  { re: /\b(killed|dead|deaths?|fatalities|shootout|firefight|ambush|siege|besieged|troops cross|ground offensive)\b/i, sev: "high" },
  { re: /\b(attack|conflict|violence|clash|assault|raid|militants?|insurgents?|terror|militia|shelling|artillery|bombing)\b/i, sev: "high" },
  { re: /\b(riot|protests? turn(?:ed)? violent|curfew|evacuated|emergency declared|state of emergency|martial law|coup)\b/i, sev: "high" },
  { re: /\b(earthquake|tsunami|wildfire|hurricane|typhoon|cyclone|volcanic eruption|magnitude \d)\b/i, sev: "high" },
  { re: /\b(protest|demonstration|standoff|sanction|threat|warning|crackdown|detained|arrested)\b/i, sev: "medium" },
];
const NOISE_RE = /\b(football|soccer|nba|nfl|mlb|cricket|tennis|golf|world cup|olympics|celebrity|box office|trailer|netflix|spotify|crypto pump|horoscope)\b/i;
const CATEGORY_RULES = [
  { cat: "conflict", re: /\b(war|airstrike|missile|troops|invasion|military|combat|soldier|killed|ceasefire|militants?|insurgents?|hostages?|drone strike|frontline|artillery|shelling)\b/i },
  { cat: "disaster", re: /\b(earthquake|tsunami|flood|wildfire|hurricane|typhoon|cyclone|volcanic|eruption|landslide|tornado|blizzard|drought)\b/i },
  { cat: "politics", re: /\b(election|parliament|president|prime minister|government|coup|protest|sanction|diplomat|treaty|summit|embassy|vote|congress|senate)\b/i },
  { cat: "economic", re: /\b(stock|market|inflation|recession|gdp|bank|currency|trade war|tariff|oil|crude|interest rate|fed|layoffs?)\b/i },
];
function regexSeverity(text) {
  for (const { re, sev } of SEVERITY_RULES) if (re.test(text)) return sev;
  return "low";
}
function regexCategory(text) {
  for (const { cat, re } of CATEGORY_RULES) if (re.test(text)) return cat;
  return "general";
}
const SEV_BASE_REL = { critical: 95, high: 75, medium: 45, low: 15 };

const GEO_INDEX = {
  ukraine:[50.45,30.52,"Ukraine"],russia:[55.75,37.62,"Russia"],israel:[31.78,35.22,"Israel"],
  gaza:[31.50,34.47,"Gaza"],lebanon:[33.89,35.50,"Lebanon"],iran:[35.69,51.39,"Iran"],
  syria:[33.51,36.29,"Syria"],yemen:[15.37,44.19,"Yemen"],taiwan:[25.03,121.57,"Taiwan"],
  china:[39.90,116.40,"China"],japan:[35.68,139.69,"Japan"],"north korea":[39.02,125.75,"North Korea"],
  "south korea":[37.57,126.98,"South Korea"],india:[28.61,77.21,"India"],pakistan:[33.68,73.05,"Pakistan"],
  afghanistan:[34.53,69.17,"Afghanistan"],turkey:[39.93,32.85,"Turkey"],iraq:[33.31,44.36,"Iraq"],
  "saudi arabia":[24.71,46.68,"Saudi Arabia"],egypt:[30.04,31.24,"Egypt"],libya:[32.89,13.19,"Libya"],
  sudan:[15.50,32.56,"Sudan"],ethiopia:[9.03,38.74,"Ethiopia"],nigeria:[9.07,7.48,"Nigeria"],
  "west bank":[31.95,35.30,"West Bank"],tehran:[35.69,51.39,"Iran"],kyiv:[50.45,30.52,"Ukraine"],
  moscow:[55.75,37.62,"Russia"],beijing:[39.90,116.40,"China"],tokyo:[35.68,139.69,"Japan"],
  haiti:[18.59,-72.31,"Haiti"],venezuela:[10.49,-66.88,"Venezuela"],myanmar:[19.74,96.10,"Myanmar"],
  france:[48.85,2.35,"France"],germany:[52.52,13.40,"Germany"],uk:[51.51,-0.13,"UK"],
  "united kingdom":[51.51,-0.13,"UK"],usa:[38.90,-77.04,"USA"],"united states":[38.90,-77.04,"USA"],
  america:[38.90,-77.04,"USA"],europe:[50.85,4.35,"Europe"],"middle east":[31.78,35.22,"Middle East"],
};
function regexGeocode(text) {
  const t = text.toLowerCase();
  const keys = Object.keys(GEO_INDEX).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (t.includes(k)) {
      const [lat, lon, label] = GEO_INDEX[k];
      return { lat, lon, region: label };
    }
  }
  return { lat: null, lon: null, region: null };
}

let __lastOllamaDiag = null;
async function ollamaClassify(systemPrompt, userPayload) {
  const OLLAMA_KEY = Netlify.env.get("OLLAMA_API_KEY");
  if (!OLLAMA_KEY) { __lastOllamaDiag = "no-key"; return null; }
  try {
    const r = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPayload },
        ],
      }),
      signal: AbortSignal.timeout(22000),
    });
    if (!r.ok) {
      __lastOllamaDiag = `http-${r.status}:${(await r.text()).slice(0, 200)}`;
      return null;
    }
    const d = await r.json();
    const txt = d.message?.content || "";
    __lastOllamaDiag = `ok:${txt.length}ch`;
    const cleaned = txt.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
    try { return JSON.parse(cleaned); } catch {}
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e) { __lastOllamaDiag += ` parse-fail:${e.message}`; } }
    __lastOllamaDiag += " no-json";
    return null;
  } catch (e) {
    __lastOllamaDiag = `throw:${e.message || e}`;
    return null;
  }
}

// ── Breaking News Watcher ──────────────────────────────────────────
const NEWS_QUERIES = [
  "breaking world news today",
  "airstrike missile war today",
  "Ukraine Russia Israel Gaza Iran today",
  "earthquake hurricane wildfire disaster today",
];

async function runBreakingNewsAgent() {
  const results = await Promise.allSettled(NEWS_QUERIES.map(fetchGoogleNewsRSS));
  const raw = [];
  for (const r of results) if (r.status === "fulfilled") raw.push(...r.value);

  // Dedup + keep freshest + drop noise
  const seen = new Map();
  for (const item of raw) {
    const title = item.headline || item.title || "";
    const desc = stripTags(item.description || "");
    if (NOISE_RE.test(title) || NOISE_RE.test(desc)) continue;
    const k = dedupKey(title);
    if (!k) continue;
    const prev = seen.get(k);
    if (!prev || item.ts > prev.ts) seen.set(k, { ...item, description: desc });
  }
  const unique = [...seen.values()].sort((a, b) => b.ts - a.ts).slice(0, 30);

  // ── Primary classification: regex (instant, reliable) ────────────
  const baseline = unique.map((it, i) => {
    const text = `${it.headline} ${it.description}`;
    const severity = regexSeverity(text);
    const category = regexCategory(text);
    const { lat, lon, region } = regexGeocode(text);
    return {
      id: `news-${it.ts}-${i}`,
      agent: "news",
      headline: it.headline,
      summary: it.description.slice(0, 280),
      url: it.link,
      source: it.source,
      severity,
      category,
      region,
      lat, lon,
      relevance: SEV_BASE_REL[severity] || 10,
      tags: [],
      ts: it.ts,
    };
  });

  // ── Optional Ollama enrichment — short budget, best-effort ───────
  // Only send the top N items by severity to keep the prompt small and
  // the roundtrip inside the remaining function budget.
  const topForLLM = [...baseline]
    .sort((a, b) => (SEV_BASE_REL[b.severity] - SEV_BASE_REL[a.severity]) || (b.ts - a.ts))
    .slice(0, 10);

  const systemPrompt = `You are Falcon Eye's intel enrichment agent. You receive pre-classified news items and rewrite them for a situational-awareness operator. Return STRICT JSON:
{"items":[{"idx":<int>,"headline":"<tight one-line rewrite>","summary":"<1-2 sentence brief>","severity":"critical|high|medium|low","relevance":<0-100>,"tags":["<tag>",...]}]}
Relevance 0-100 — breaking conflict/casualty/disaster = 80-100, political background = 30-60, general = 0-30. Keep summaries factual and short.`;
  const payload = JSON.stringify({
    items: topForLLM.map((it, i) => ({
      idx: i,
      title: it.headline,
      description: it.summary.slice(0, 240),
      source: it.source,
      severity: it.severity,
    })),
  });

  const classified = await ollamaClassify(systemPrompt, payload);
  if (classified && Array.isArray(classified.items)) {
    const byId = new Map(baseline.map((b) => [b.id, b]));
    for (const ci of classified.items) {
      const src = topForLLM[ci.idx];
      if (!src) continue;
      const target = byId.get(src.id);
      if (!target) continue;
      if (ci.headline) target.headline = ci.headline;
      if (ci.summary) target.summary = ci.summary;
      if (ci.severity) target.severity = ci.severity;
      if (typeof ci.relevance === "number") target.relevance = ci.relevance;
      if (Array.isArray(ci.tags)) target.tags = ci.tags.slice(0, 6);
    }
  }

  const sevWeight = { critical: 4, high: 3, medium: 2, low: 1 };
  baseline.sort((a, b) => {
    const sw = (sevWeight[b.severity] || 0) - (sevWeight[a.severity] || 0);
    if (sw !== 0) return sw;
    const rw = (b.relevance || 0) - (a.relevance || 0);
    if (rw !== 0) return rw;
    return (b.ts || 0) - (a.ts || 0);
  });

  return { items: baseline.slice(0, 60), ts: Date.now(), llm: !!classified, diag: __lastOllamaDiag };
}

// ── Registry of agents ─────────────────────────────────────────────
const AGENTS = {
  news: { label: "Breaking News Watcher", run: runBreakingNewsAgent },
};

async function getOrRun(store, agentName, force = false) {
  const agent = AGENTS[agentName];
  if (!agent) return null;
  const key = `swarm:${agentName}`;
  if (!force) {
    try {
      const cached = await store.get(key, { type: "json" });
      if (cached && Date.now() - (cached.ts || 0) < AGENT_TTL_MS) {
        return { ...cached, cache: "HIT" };
      }
    } catch {}
  }
  const fresh = await agent.run();
  try { await store.setJSON(key, fresh); } catch {}
  return { ...fresh, cache: "MISS" };
}

export default async (req) => {
  const store = getStore("darvis-falcon-eye");
  const url = new URL(req.url);

  if (req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch {}
    const name = body.agent;
    if (!name || !AGENTS[name]) return Response.json({ error: "unknown agent" }, { status: 400 });
    const data = await getOrRun(store, name, true);
    return Response.json({ agent: name, ...data });
  }

  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const single = url.searchParams.get("agent");
  if (single) {
    if (!AGENTS[single]) return Response.json({ error: "unknown agent" }, { status: 400 });
    const data = await getOrRun(store, single);
    return Response.json({ agent: single, ...data });
  }

  // Aggregate across all agents
  const names = Object.keys(AGENTS);
  const results = await Promise.allSettled(names.map((n) => getOrRun(store, n)));
  const agents = {};
  const merged = [];
  names.forEach((n, i) => {
    const r = results[i];
    if (r.status === "fulfilled" && r.value) {
      agents[n] = { label: AGENTS[n].label, ts: r.value.ts, cache: r.value.cache, count: r.value.items?.length || 0 };
      if (Array.isArray(r.value.items)) merged.push(...r.value.items);
    } else {
      agents[n] = { label: AGENTS[n].label, error: String(r.reason || "failed") };
    }
  });

  const sevWeight = { critical: 4, high: 3, medium: 2, low: 1 };
  merged.sort((a, b) => {
    const sw = (sevWeight[b.severity] || 0) - (sevWeight[a.severity] || 0);
    if (sw !== 0) return sw;
    const rw = (b.relevance || 0) - (a.relevance || 0);
    if (rw !== 0) return rw;
    return (b.ts || 0) - (a.ts || 0);
  });

  return Response.json({
    ts: Date.now(),
    agents,
    items: merged.slice(0, 120),
    total: merged.length,
  });
};

export const config = { path: "/api/falcon-eye/swarm" };
