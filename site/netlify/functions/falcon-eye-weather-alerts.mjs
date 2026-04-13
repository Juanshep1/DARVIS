import { getStore } from "@netlify/blobs";

const CACHE_MS = 3 * 60 * 1000;

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const store = getStore("darvis-falcon-eye");
  try {
    const cached = await store.get("weather-alerts", { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  try {
    const r = await fetch("https://api.weather.gov/alerts/active", {
      headers: {
        "User-Agent": "FalconEye/1.0 (darvis1.netlify.app)",
        Accept: "application/geo+json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return Response.json({ alerts: [], error: `noaa ${r.status}` });
    const data = await r.json();

    const alerts = (data.features || []).map((f) => {
      const p = f.properties || {};
      return {
        id: p.id,
        event: p.event || "",
        severity: (p.severity || "Unknown").toLowerCase(),
        urgency: p.urgency || "",
        certainty: p.certainty || "",
        headline: p.headline || p.event || "",
        description: p.description || "",
        instruction: p.instruction || "",
        area: p.areaDesc || "",
        effective: p.effective,
        expires: p.expires,
        sent: p.sent,
        sender: p.senderName || "",
        geometry: f.geometry || null,
      };
    });

    const out = { alerts, count: alerts.length, ts: Date.now() };
    try { await store.setJSON("weather-alerts", { data: out, ts: Date.now() }); } catch {}
    return Response.json(out);
  } catch (e) {
    return Response.json({ alerts: [], error: String(e) });
  }
};

export const config = { path: "/api/falcon-eye/weather-alerts" };
