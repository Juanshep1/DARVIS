import { getStore } from "@netlify/blobs";

const CACHE_MS = 60_000;

const HOTSPOTS = {
  ukraine: { lat: 50.45, lon: 30.52, label: "Ukraine" },
  russia: { lat: 55.75, lon: 37.62, label: "Russia" },
  israel: { lat: 31.78, lon: 35.22, label: "Israel" },
  gaza: { lat: 31.50, lon: 34.47, label: "Gaza" },
  lebanon: { lat: 33.89, lon: 35.50, label: "Lebanon" },
  iran: { lat: 35.69, lon: 51.39, label: "Iran" },
  syria: { lat: 33.51, lon: 36.29, label: "Syria" },
  yemen: { lat: 15.37, lon: 44.19, label: "Yemen" },
  taiwan: { lat: 25.03, lon: 121.57, label: "Taiwan" },
  china: { lat: 39.90, lon: 116.40, label: "China" },
  korea: { lat: 39.02, lon: 125.75, label: "Korea" },
  sudan: { lat: 15.50, lon: 32.56, label: "Sudan" },
  ethiopia: { lat: 9.03, lon: 38.74, label: "Ethiopia" },
  haiti: { lat: 18.59, lon: -72.31, label: "Haiti" },
  venezuela: { lat: 10.49, lon: -66.88, label: "Venezuela" },
  mexico: { lat: 19.43, lon: -99.13, label: "Mexico" },
  unitedstates: { lat: 38.90, lon: -77.04, label: "United States" },
  uk: { lat: 51.51, lon: -0.13, label: "United Kingdom" },
  france: { lat: 48.85, lon: 2.35, label: "France" },
  germany: { lat: 52.52, lon: 13.40, label: "Germany" },
  india: { lat: 28.61, lon: 77.21, label: "India" },
  pakistan: { lat: 33.68, lon: 73.05, label: "Pakistan" },
  afghanistan: { lat: 34.53, lon: 69.17, label: "Afghanistan" },
  myanmar: { lat: 19.74, lon: 96.10, label: "Myanmar" },
  nigeria: { lat: 9.07, lon: 7.48, label: "Nigeria" },
  libya: { lat: 32.89, lon: 13.19, label: "Libya" },
  egypt: { lat: 30.04, lon: 31.24, label: "Egypt" },
  turkey: { lat: 39.93, lon: 32.85, label: "Turkey" },
  poland: { lat: 52.23, lon: 21.01, label: "Poland" },
  southafrica: { lat: -25.75, lon: 28.19, label: "South Africa" },
};

const SEVERITY_KEYWORDS = [
  { re: /\b(nuclear|missile strike|invasion|war breaks out|declared war|airstrike|bombing)\b/i, severity: "critical" },
  { re: /\b(killed|attack|explosion|conflict|violence|strike|clash|drone)\b/i, severity: "high" },
  { re: /\b(protest|tension|sanction|warning|threat)\b/i, severity: "medium" },
];

function severityFor(text) {
  for (const { re, severity } of SEVERITY_KEYWORDS) if (re.test(text)) return severity;
  return "low";
}

function geocode(text) {
  const t = text.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, v] of Object.entries(HOTSPOTS)) if (t.includes(k)) return v;
  return null;
}

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const TAVILY_KEY = Netlify.env.get("TAVILY_API_KEY");
  const store = getStore("darvis-falcon-eye");
  const url = new URL(req.url);
  const region = url.searchParams.get("region") || "";

  const cacheKey = `news:${region || "global"}`;
  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
  } catch {}

  if (!TAVILY_KEY) return Response.json({ alerts: [], error: "no key" });

  const query = region
    ? `breaking news ${region} conflict war today`
    : "breaking world news war conflict today";

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_KEY, query, search_depth: "basic", max_results: 12, include_answer: false }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return Response.json({ alerts: [], error: `tavily ${res.status}` });
    const data = await res.json();

    const alerts = [];
    for (const r of data.results || []) {
      const text = `${r.title} ${r.content || ""}`;
      const loc = region ? HOTSPOTS[region.toLowerCase().replace(/[^a-z]/g, "")] || geocode(text) : geocode(text);
      if (!loc) continue;
      alerts.push({
        headline: r.title,
        snippet: (r.content || "").slice(0, 240),
        url: r.url,
        source: r.url ? new URL(r.url).hostname.replace(/^www\./, "") : "",
        lat: loc.lat,
        lon: loc.lon,
        region: loc.label,
        severity: severityFor(text),
        ts: Date.now(),
      });
    }

    const out = { alerts, ts: Date.now() };
    try { await store.setJSON(cacheKey, { data: out, ts: Date.now() }); } catch {}
    return Response.json(out);
  } catch (e) {
    return Response.json({ alerts: [], error: String(e) });
  }
};

export const config = { path: "/api/falcon-eye/news" };
