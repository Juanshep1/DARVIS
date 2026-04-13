import { getStore } from "@netlify/blobs";

const CACHE_MS = 30 * 60 * 1000;

// Curated known-public HLS / iframe webcams that work without an API key.
// Used as fallback when WINDY_API_KEY is not configured, OR merged with
// Windy results to ensure something is always visible.
const FALLBACK_WEBCAMS = [
  { id: "fb-times-square", label: "Times Square, New York", lat: 40.7580, lon: -73.9855,
    kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=tsrobo1" },
  { id: "fb-shibuya", label: "Shibuya Crossing, Tokyo", lat: 35.6595, lon: 139.7004,
    kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/japan/kanto/tokyo/shibuya-crossing.html" },
  { id: "fb-venice", label: "St Mark's Square, Venice", lat: 45.4340, lon: 12.3388,
    kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/italia/veneto/venezia/piazza-san-marco.html" },
  { id: "fb-dubai", label: "Dubai Marina", lat: 25.0805, lon: 55.1403,
    kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/united-arab-emirates/dubai/dubai/dubai-marina.html" },
  { id: "fb-loch-ness", label: "Loch Ness, Scotland", lat: 57.3229, lon: -4.4244,
    kind: "iframe", url: "https://www.lochness.co.uk/livecam/" },
  { id: "fb-niagara", label: "Niagara Falls", lat: 43.0962, lon: -79.0377,
    kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=niagarafalls_str" },
  { id: "fb-eiffel", label: "Eiffel Tower, Paris", lat: 48.8584, lon: 2.2945,
    kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/france/ile-de-france/paris/tour-eiffel.html" },
  { id: "fb-rome", label: "Trevi Fountain, Rome", lat: 41.9009, lon: 12.4833,
    kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/italia/lazio/roma/fontana-di-trevi.html" },
  { id: "fb-rio", label: "Copacabana Beach, Rio", lat: -22.9711, lon: -43.1822,
    kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/brasil/rio-de-janeiro/rio-de-janeiro/copacabana-beach.html" },
  { id: "fb-sydney", label: "Sydney Harbour, Australia", lat: -33.8523, lon: 151.2108,
    kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/australia/new-south-wales/sydney/sydney-harbour.html" },
  { id: "fb-hk", label: "Victoria Harbour, Hong Kong", lat: 22.2934, lon: 114.1694,
    kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/china/hong-kong/hong-kong/victoria-harbour.html" },
  { id: "fb-vegas", label: "Las Vegas Strip", lat: 36.1147, lon: -115.1728,
    kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=lasvegas_strip" },
];

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const KEY = Netlify.env.get("WINDY_API_KEY");
  const store = getStore("darvis-falcon-eye");

  if (!KEY) {
    return Response.json({ webcams: FALLBACK_WEBCAMS, source: "fallback" });
  }

  try {
    const cached = await store.get("webcams", { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  try {
    const res = await fetch(
      "https://api.windy.com/webcams/api/v3/webcams?include=location,player,images&limit=100&lang=en",
      {
        headers: { "x-windy-api-key": KEY },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) {
      return Response.json({ webcams: FALLBACK_WEBCAMS, source: "fallback", error: `windy ${res.status}` });
    }
    const data = await res.json();
    const fromWindy = (data.webcams || []).map((w) => {
      const live = w.player?.live || w.player?.day || w.player?.month || w.player?.year;
      const isHls = typeof live === "string" && /\.m3u8/i.test(live);
      return {
        id: `windy-${w.webcamId}`,
        label: w.title || "Webcam",
        lat: w.location?.latitude,
        lon: w.location?.longitude,
        kind: isHls ? "hls" : "iframe",
        url: live || `https://www.windy.com/webcams/${w.webcamId}`,
        thumb: w.images?.current?.preview || null,
      };
    }).filter((w) => w.lat != null && w.lon != null);

    const merged = [...fromWindy, ...FALLBACK_WEBCAMS];
    const out = { webcams: merged, source: "windy", ts: Date.now() };
    try { await store.setJSON("webcams", { data: out, ts: Date.now() }); } catch {}
    return Response.json(out);
  } catch (e) {
    return Response.json({ webcams: FALLBACK_WEBCAMS, source: "fallback", error: String(e) });
  }
};

export const config = { path: "/api/falcon-eye/webcams" };
