import { getStore } from "@netlify/blobs";

const CACHE_MS = 60_000;

const HOTSPOTS = {
  // North America
  unitedstates: { lat: 38.90, lon: -77.04, label: "United States" },
  usa: { lat: 38.90, lon: -77.04, label: "United States" },
  canada: { lat: 45.42, lon: -75.69, label: "Canada" },
  mexico: { lat: 19.43, lon: -99.13, label: "Mexico" },
  cuba: { lat: 23.13, lon: -82.38, label: "Cuba" },
  haiti: { lat: 18.59, lon: -72.31, label: "Haiti" },
  dominicanrepublic: { lat: 18.47, lon: -69.93, label: "Dominican Republic" },
  jamaica: { lat: 17.97, lon: -76.79, label: "Jamaica" },
  guatemala: { lat: 14.63, lon: -90.51, label: "Guatemala" },
  honduras: { lat: 14.07, lon: -87.19, label: "Honduras" },
  elsalvador: { lat: 13.69, lon: -89.21, label: "El Salvador" },
  nicaragua: { lat: 12.13, lon: -86.25, label: "Nicaragua" },
  costarica: { lat: 9.93, lon: -84.08, label: "Costa Rica" },
  panama: { lat: 8.98, lon: -79.52, label: "Panama" },
  // South America
  brazil: { lat: -15.78, lon: -47.93, label: "Brazil" },
  argentina: { lat: -34.61, lon: -58.38, label: "Argentina" },
  chile: { lat: -33.45, lon: -70.67, label: "Chile" },
  colombia: { lat: 4.71, lon: -74.07, label: "Colombia" },
  venezuela: { lat: 10.49, lon: -66.88, label: "Venezuela" },
  peru: { lat: -12.05, lon: -77.04, label: "Peru" },
  ecuador: { lat: -0.18, lon: -78.47, label: "Ecuador" },
  bolivia: { lat: -16.50, lon: -68.13, label: "Bolivia" },
  uruguay: { lat: -34.90, lon: -56.16, label: "Uruguay" },
  paraguay: { lat: -25.26, lon: -57.58, label: "Paraguay" },
  guyana: { lat: 6.80, lon: -58.16, label: "Guyana" },
  suriname: { lat: 5.85, lon: -55.20, label: "Suriname" },
  // Europe (West / Central)
  unitedkingdom: { lat: 51.51, lon: -0.13, label: "United Kingdom" },
  uk: { lat: 51.51, lon: -0.13, label: "United Kingdom" },
  britain: { lat: 51.51, lon: -0.13, label: "United Kingdom" },
  ireland: { lat: 53.35, lon: -6.26, label: "Ireland" },
  france: { lat: 48.85, lon: 2.35, label: "France" },
  germany: { lat: 52.52, lon: 13.40, label: "Germany" },
  spain: { lat: 40.42, lon: -3.70, label: "Spain" },
  portugal: { lat: 38.72, lon: -9.14, label: "Portugal" },
  italy: { lat: 41.90, lon: 12.50, label: "Italy" },
  netherlands: { lat: 52.37, lon: 4.90, label: "Netherlands" },
  belgium: { lat: 50.85, lon: 4.35, label: "Belgium" },
  switzerland: { lat: 46.95, lon: 7.45, label: "Switzerland" },
  austria: { lat: 48.21, lon: 16.37, label: "Austria" },
  denmark: { lat: 55.68, lon: 12.57, label: "Denmark" },
  norway: { lat: 59.91, lon: 10.75, label: "Norway" },
  sweden: { lat: 59.33, lon: 18.07, label: "Sweden" },
  finland: { lat: 60.17, lon: 24.94, label: "Finland" },
  iceland: { lat: 64.13, lon: -21.82, label: "Iceland" },
  // Europe (East / South-East)
  poland: { lat: 52.23, lon: 21.01, label: "Poland" },
  czech: { lat: 50.09, lon: 14.42, label: "Czech Republic" },
  czechia: { lat: 50.09, lon: 14.42, label: "Czech Republic" },
  slovakia: { lat: 48.15, lon: 17.11, label: "Slovakia" },
  hungary: { lat: 47.50, lon: 19.04, label: "Hungary" },
  romania: { lat: 44.43, lon: 26.10, label: "Romania" },
  bulgaria: { lat: 42.70, lon: 23.32, label: "Bulgaria" },
  greece: { lat: 37.98, lon: 23.73, label: "Greece" },
  serbia: { lat: 44.79, lon: 20.46, label: "Serbia" },
  croatia: { lat: 45.81, lon: 15.98, label: "Croatia" },
  bosnia: { lat: 43.86, lon: 18.41, label: "Bosnia" },
  albania: { lat: 41.33, lon: 19.82, label: "Albania" },
  kosovo: { lat: 42.67, lon: 21.17, label: "Kosovo" },
  northmacedonia: { lat: 41.99, lon: 21.43, label: "North Macedonia" },
  moldova: { lat: 47.01, lon: 28.86, label: "Moldova" },
  belarus: { lat: 53.90, lon: 27.57, label: "Belarus" },
  ukraine: { lat: 50.45, lon: 30.52, label: "Ukraine" },
  russia: { lat: 55.75, lon: 37.62, label: "Russia" },
  // Middle East
  israel: { lat: 31.78, lon: 35.22, label: "Israel" },
  palestine: { lat: 31.90, lon: 35.20, label: "Palestine" },
  gaza: { lat: 31.50, lon: 34.47, label: "Gaza" },
  westbank: { lat: 31.95, lon: 35.30, label: "West Bank" },
  lebanon: { lat: 33.89, lon: 35.50, label: "Lebanon" },
  syria: { lat: 33.51, lon: 36.29, label: "Syria" },
  jordan: { lat: 31.95, lon: 35.93, label: "Jordan" },
  iraq: { lat: 33.31, lon: 44.36, label: "Iraq" },
  iran: { lat: 35.69, lon: 51.39, label: "Iran" },
  yemen: { lat: 15.37, lon: 44.19, label: "Yemen" },
  oman: { lat: 23.59, lon: 58.41, label: "Oman" },
  qatar: { lat: 25.29, lon: 51.53, label: "Qatar" },
  bahrain: { lat: 26.23, lon: 50.59, label: "Bahrain" },
  kuwait: { lat: 29.38, lon: 47.99, label: "Kuwait" },
  saudiarabia: { lat: 24.71, lon: 46.68, label: "Saudi Arabia" },
  uae: { lat: 24.45, lon: 54.38, label: "UAE" },
  unitedarabemirates: { lat: 24.45, lon: 54.38, label: "UAE" },
  turkey: { lat: 39.93, lon: 32.85, label: "Turkey" },
  cyprus: { lat: 35.18, lon: 33.38, label: "Cyprus" },
  // Africa
  egypt: { lat: 30.04, lon: 31.24, label: "Egypt" },
  libya: { lat: 32.89, lon: 13.19, label: "Libya" },
  tunisia: { lat: 36.81, lon: 10.18, label: "Tunisia" },
  algeria: { lat: 36.75, lon: 3.06, label: "Algeria" },
  morocco: { lat: 34.02, lon: -6.83, label: "Morocco" },
  sudan: { lat: 15.50, lon: 32.56, label: "Sudan" },
  southsudan: { lat: 4.85, lon: 31.58, label: "South Sudan" },
  ethiopia: { lat: 9.03, lon: 38.74, label: "Ethiopia" },
  eritrea: { lat: 15.32, lon: 38.93, label: "Eritrea" },
  somalia: { lat: 2.05, lon: 45.32, label: "Somalia" },
  kenya: { lat: -1.29, lon: 36.82, label: "Kenya" },
  uganda: { lat: 0.35, lon: 32.58, label: "Uganda" },
  tanzania: { lat: -6.79, lon: 39.21, label: "Tanzania" },
  rwanda: { lat: -1.95, lon: 30.06, label: "Rwanda" },
  burundi: { lat: -3.36, lon: 29.36, label: "Burundi" },
  congo: { lat: -4.32, lon: 15.32, label: "DR Congo" },
  drc: { lat: -4.32, lon: 15.32, label: "DR Congo" },
  nigeria: { lat: 9.07, lon: 7.48, label: "Nigeria" },
  ghana: { lat: 5.60, lon: -0.19, label: "Ghana" },
  ivorycoast: { lat: 6.83, lon: -5.27, label: "Ivory Coast" },
  senegal: { lat: 14.69, lon: -17.45, label: "Senegal" },
  mali: { lat: 12.64, lon: -8.00, label: "Mali" },
  burkinafaso: { lat: 12.37, lon: -1.52, label: "Burkina Faso" },
  niger: { lat: 13.51, lon: 2.11, label: "Niger" },
  chad: { lat: 12.13, lon: 15.05, label: "Chad" },
  cameroon: { lat: 3.85, lon: 11.50, label: "Cameroon" },
  centralafrica: { lat: 4.39, lon: 18.56, label: "Central African Republic" },
  angola: { lat: -8.84, lon: 13.23, label: "Angola" },
  zambia: { lat: -15.42, lon: 28.28, label: "Zambia" },
  zimbabwe: { lat: -17.83, lon: 31.05, label: "Zimbabwe" },
  mozambique: { lat: -25.97, lon: 32.58, label: "Mozambique" },
  madagascar: { lat: -18.88, lon: 47.51, label: "Madagascar" },
  southafrica: { lat: -25.75, lon: 28.19, label: "South Africa" },
  namibia: { lat: -22.56, lon: 17.07, label: "Namibia" },
  botswana: { lat: -24.66, lon: 25.91, label: "Botswana" },
  // South Asia
  india: { lat: 28.61, lon: 77.21, label: "India" },
  pakistan: { lat: 33.68, lon: 73.05, label: "Pakistan" },
  afghanistan: { lat: 34.53, lon: 69.17, label: "Afghanistan" },
  bangladesh: { lat: 23.81, lon: 90.41, label: "Bangladesh" },
  nepal: { lat: 27.71, lon: 85.32, label: "Nepal" },
  bhutan: { lat: 27.47, lon: 89.64, label: "Bhutan" },
  srilanka: { lat: 6.93, lon: 79.86, label: "Sri Lanka" },
  // East / South East Asia
  china: { lat: 39.90, lon: 116.40, label: "China" },
  taiwan: { lat: 25.03, lon: 121.57, label: "Taiwan" },
  hongkong: { lat: 22.32, lon: 114.17, label: "Hong Kong" },
  japan: { lat: 35.68, lon: 139.69, label: "Japan" },
  southkorea: { lat: 37.57, lon: 126.98, label: "South Korea" },
  northkorea: { lat: 39.02, lon: 125.75, label: "North Korea" },
  korea: { lat: 39.02, lon: 125.75, label: "Korea" },
  mongolia: { lat: 47.89, lon: 106.91, label: "Mongolia" },
  vietnam: { lat: 21.03, lon: 105.85, label: "Vietnam" },
  laos: { lat: 17.97, lon: 102.60, label: "Laos" },
  cambodia: { lat: 11.55, lon: 104.92, label: "Cambodia" },
  thailand: { lat: 13.76, lon: 100.50, label: "Thailand" },
  myanmar: { lat: 19.74, lon: 96.10, label: "Myanmar" },
  burma: { lat: 19.74, lon: 96.10, label: "Myanmar" },
  malaysia: { lat: 3.14, lon: 101.69, label: "Malaysia" },
  singapore: { lat: 1.35, lon: 103.82, label: "Singapore" },
  indonesia: { lat: -6.21, lon: 106.85, label: "Indonesia" },
  philippines: { lat: 14.60, lon: 120.98, label: "Philippines" },
  brunei: { lat: 4.90, lon: 114.94, label: "Brunei" },
  timorleste: { lat: -8.56, lon: 125.56, label: "Timor-Leste" },
  // Central Asia / Caucasus
  kazakhstan: { lat: 51.16, lon: 71.45, label: "Kazakhstan" },
  uzbekistan: { lat: 41.31, lon: 69.24, label: "Uzbekistan" },
  turkmenistan: { lat: 37.95, lon: 58.38, label: "Turkmenistan" },
  kyrgyzstan: { lat: 42.87, lon: 74.59, label: "Kyrgyzstan" },
  tajikistan: { lat: 38.56, lon: 68.79, label: "Tajikistan" },
  georgia: { lat: 41.72, lon: 44.78, label: "Georgia" },
  armenia: { lat: 40.18, lon: 44.51, label: "Armenia" },
  azerbaijan: { lat: 40.41, lon: 49.87, label: "Azerbaijan" },
  // Oceania
  australia: { lat: -35.28, lon: 149.13, label: "Australia" },
  newzealand: { lat: -41.29, lon: 174.78, label: "New Zealand" },
  papuanewguinea: { lat: -9.44, lon: 147.18, label: "Papua New Guinea" },
  fiji: { lat: -18.12, lon: 178.42, label: "Fiji" },
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
