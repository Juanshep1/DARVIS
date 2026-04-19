import { Hono } from "hono";
import type { Env } from "../../env";
import { kvGetJSON, kvSetJSON } from "../../lib/kv";

export const feNewsRoutes = new Hono<{ Bindings: Env }>();

// ── Helpers ──────────────────────────────────────────────────────────────
function stripTags(s: string): string { return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(); }
function decodeEntities(s: string): string {
  return (s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

async function fetchGoogleNewsRSS(query: string): Promise<{ title: string; link: string; pubDate: string; source: string; description: string }[]> {
  const u = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 FalconEye" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    return items.slice(0, 20).map((m) => {
      const body = m[1];
      const get = (tag: string) => {
        const match = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`));
        return match ? decodeEntities(stripTags(match[1])) : "";
      };
      return {
        title: get("title"),
        link: get("link"),
        pubDate: get("pubDate"),
        source: get("source"),
        description: get("description"),
      };
    }).filter((n) => n.title && n.link);
  } catch {
    return [];
  }
}

// ── /news for a region ───────────────────────────────────────────────────
feNewsRoutes.get("/news", async (c) => {
  const region = (c.req.query("region") || "world").toLowerCase();
  const cacheKey = `news:${region}`;
  const cached = await kvGetJSON<{ data: unknown; ts: number }>(c.env, "falcon-eye", cacheKey);
  if (cached && Date.now() - cached.ts < 60_000) return c.json(cached.data);

  const items = await fetchGoogleNewsRSS(region === "world" ? "world news today" : `${region} news`);
  const out = { region, items, ts: Date.now() };
  await kvSetJSON(c.env, "falcon-eye", cacheKey, { data: out, ts: Date.now() });
  return c.json(out);
});

// ── /swarm — aggregated intel feed ───────────────────────────────────────
// Exposes the individual agent outputs (news/camera/aircraft) that other
// jobs can populate via POST. Schedulers can write to `swarm:<agent>` keys.
feNewsRoutes.get("/swarm", async (c) => {
  const agent = c.req.query("agent");
  if (agent) {
    const data = await kvGetJSON(c.env, "falcon-eye", `swarm:${agent}`);
    return c.json({ agent, data });
  }
  const [news, cams, aircraft] = await Promise.all([
    kvGetJSON(c.env, "falcon-eye", "swarm:news"),
    kvGetJSON(c.env, "falcon-eye", "swarm:cameras"),
    kvGetJSON(c.env, "falcon-eye", "swarm:aircraft"),
  ]);
  return c.json({ news, cams, aircraft, ts: Date.now() });
});

feNewsRoutes.post("/swarm", async (c) => {
  const body = await c.req.json<{ agent?: string; data?: unknown }>().catch(() => ({} as { agent?: string; data?: unknown }));
  if (!body.agent) return c.json({ error: "missing agent" }, 400);
  await kvSetJSON(c.env, "falcon-eye", `swarm:${body.agent}`, { data: body.data, ts: Date.now() });
  return c.json({ ok: true });
});

// ── /live-video — validated HLS stream list ──────────────────────────────
const SEED_LIVE_STREAMS = [
  { id: "al-jazeera", label: "Al Jazeera English", url: "https://live-hls-web-aje.getaj.net/AJE/01.m3u8", lat: 25.2867, lon: 51.5333, category: "news", region: "Qatar" },
  { id: "dw-news", label: "DW News", url: "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8", lat: 52.52, lon: 13.41, category: "news", region: "Germany" },
  { id: "france24", label: "France 24 English", url: "https://live.france24.com/hls/live/2037218-b/F24_EN_HI_HLS/master.m3u8", lat: 48.85, lon: 2.35, category: "news", region: "France" },
];

feNewsRoutes.get("/live-video", async (c) => {
  const cached = await kvGetJSON<{ cams: unknown[]; ts: number }>(c.env, "falcon-eye", "swarm:live-cams");
  if (cached && Date.now() - cached.ts < 10 * 60 * 1000) return c.json(cached);
  return c.json({ cams: SEED_LIVE_STREAMS, ts: Date.now() });
});

feNewsRoutes.post("/live-video", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  if (!body.url) return c.json({ error: "missing url" }, 400);
  const candidates = ((await kvGetJSON<unknown[]>(c.env, "falcon-eye", "swarm:live-cams:candidates")) || []).slice();
  candidates.push({ ...body, ts: Date.now() });
  await kvSetJSON(c.env, "falcon-eye", "swarm:live-cams:candidates", candidates);
  return c.json({ ok: true });
});

// ── /vessels — aisstream snapshot reader (write side is a scheduled ingestor) ──
feNewsRoutes.get("/vessels", async (c) => {
  const snapshot = await kvGetJSON<{ meta?: { vesselsByMmsi?: Record<string, unknown> }; features?: unknown[]; ts?: number }>(c.env, "falcon-eye", "maritime:vessels:snapshot");
  if (!snapshot) return c.json({ type: "FeatureCollection", features: [], note: "No vessel data yet — ingestor hasn't run." });
  return c.json(snapshot);
});

feNewsRoutes.get("/vessels-ingest", async (c) => {
  return c.json({
    ok: false,
    note: "Vessels ingestion requires a persistent WebSocket connection to aisstream.io. Run on a separate worker or server; Cloudflare Workers CPU budget is too small for a 60s WS window. Stubbed for now.",
  });
});

feNewsRoutes.get("/vessels-cron", async (c) => {
  return c.json({ ok: false, note: "cron handler — triggered via Workers scheduled event, not HTTP" });
});
