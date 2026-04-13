import { getStore } from "@netlify/blobs";

const CACHE_MS = 20 * 60 * 1000;

// Curated EarthCam embeds — these specifically allow iframe embedding via
// the /cams/embed/ URL pattern. Skyline Webcams pages block X-Frame-Options
// so we don't ship them. Supplemented by Windy API timelapse players when
// WINDY_API_KEY is set (which returns 200+ real, working embed URLs).
const _UNUSED_FALLBACK_WEBCAMS = [
  // North America
  { id: "fb-times-square", label: "Times Square, New York", lat: 40.7580, lon: -73.9855, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=tsrobo1" },
  { id: "fb-vegas", label: "Las Vegas Strip", lat: 36.1147, lon: -115.1728, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=lasvegas_strip" },
  { id: "fb-niagara", label: "Niagara Falls", lat: 43.0962, lon: -79.0377, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=niagarafalls_str" },
  { id: "fb-new-orleans", label: "Bourbon Street, New Orleans", lat: 29.9584, lon: -90.0653, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=catsmeow" },
  { id: "fb-miami", label: "Miami Beach", lat: 25.7907, lon: -80.1300, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/united-states/florida/miami-beach/miami-beach.html" },
  { id: "fb-key-west", label: "Key West, Florida", lat: 24.5551, lon: -81.7800, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/united-states/florida/key-west/key-west.html" },
  { id: "fb-sf-pier", label: "Pier 39, San Francisco", lat: 37.8087, lon: -122.4098, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=pier39" },
  { id: "fb-hollywood", label: "Hollywood Sign", lat: 34.1341, lon: -118.3215, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/united-states/california/los-angeles/hollywood.html" },
  { id: "fb-chicago", label: "Navy Pier, Chicago", lat: 41.8918, lon: -87.6058, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/united-states/illinois/chicago/navy-pier.html" },
  { id: "fb-dallas", label: "Dallas Skyline", lat: 32.7767, lon: -96.7970, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/united-states/texas/dallas/dallas.html" },
  { id: "fb-aspen", label: "Aspen, Colorado", lat: 39.1911, lon: -106.8175, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/united-states/colorado/aspen/aspen.html" },
  { id: "fb-toronto", label: "Toronto CN Tower", lat: 43.6426, lon: -79.3871, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/canada/ontario/toronto/toronto.html" },
  // Europe — west
  { id: "fb-eiffel", label: "Eiffel Tower, Paris", lat: 48.8584, lon: 2.2945, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/france/ile-de-france/paris/tour-eiffel.html" },
  { id: "fb-louvre", label: "Louvre, Paris", lat: 48.8606, lon: 2.3376, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/france/ile-de-france/paris/louvre.html" },
  { id: "fb-london", label: "London Skyline", lat: 51.5074, lon: -0.1278, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/united-kingdom/england/london/london.html" },
  { id: "fb-big-ben", label: "Big Ben, London", lat: 51.5007, lon: -0.1246, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/united-kingdom/england/london/big-ben.html" },
  { id: "fb-loch-ness", label: "Loch Ness, Scotland", lat: 57.3229, lon: -4.4244, kind: "iframe", url: "https://www.lochness.co.uk/livecam/" },
  { id: "fb-amsterdam", label: "Amsterdam Canal", lat: 52.3676, lon: 4.9041, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/nederland/noord-holland/amsterdam/amsterdam.html" },
  { id: "fb-brussels", label: "Brussels Grand Place", lat: 50.8467, lon: 4.3525, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/belgie/brussels-hoofdstedelijk-gewest/brussels/grand-place.html" },
  { id: "fb-berlin", label: "Berlin Brandenburg Gate", lat: 52.5163, lon: 13.3777, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/deutschland/berlin/berlin/brandenburger-tor.html" },
  { id: "fb-munich", label: "Munich Marienplatz", lat: 48.1374, lon: 11.5755, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/deutschland/bayern/munchen/marienplatz.html" },
  { id: "fb-zurich", label: "Zurich, Switzerland", lat: 47.3769, lon: 8.5417, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/schweiz/zurich/zurich/zurich.html" },
  { id: "fb-geneva", label: "Geneva Lake", lat: 46.2044, lon: 6.1432, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/schweiz/geneve/geneva/lake-geneva.html" },
  { id: "fb-vienna", label: "Vienna Stephansplatz", lat: 48.2082, lon: 16.3738, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/osterreich/wien/wien/stephansplatz.html" },
  { id: "fb-prague", label: "Prague Old Town", lat: 50.0875, lon: 14.4213, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/ceska-republika/hlavni-mesto-praha/praha/staromestske-namesti.html" },
  { id: "fb-budapest", label: "Budapest Danube", lat: 47.4979, lon: 19.0402, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/magyarorszag/budapest/budapest/budapest.html" },
  { id: "fb-warsaw", label: "Warsaw Old Town", lat: 52.2297, lon: 21.0122, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/polska/mazowieckie/warszawa/warszawa.html" },
  { id: "fb-copenhagen", label: "Copenhagen Harbour", lat: 55.6761, lon: 12.5683, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/danmark/copenhagen/copenhagen/copenhagen.html" },
  { id: "fb-stockholm", label: "Stockholm Old Town", lat: 59.3293, lon: 18.0686, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/sverige/stockholm/stockholm/stockholm.html" },
  { id: "fb-oslo", label: "Oslo Harbour", lat: 59.9139, lon: 10.7522, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/norge/oslo/oslo/oslo.html" },
  { id: "fb-reykjavik", label: "Reykjavik, Iceland", lat: 64.1466, lon: -21.9426, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/island/capital-region/reykjavik/reykjavik.html" },
  // Europe — south
  { id: "fb-venice", label: "St Mark's Square, Venice", lat: 45.4340, lon: 12.3388, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/italia/veneto/venezia/piazza-san-marco.html" },
  { id: "fb-rome-trevi", label: "Trevi Fountain, Rome", lat: 41.9009, lon: 12.4833, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/italia/lazio/roma/fontana-di-trevi.html" },
  { id: "fb-rome-colos", label: "Colosseum, Rome", lat: 41.8902, lon: 12.4922, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/italia/lazio/roma/colosseo.html" },
  { id: "fb-florence", label: "Florence Duomo", lat: 43.7731, lon: 11.2559, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/italia/toscana/firenze/firenze.html" },
  { id: "fb-milan", label: "Milan Duomo", lat: 45.4642, lon: 9.1900, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/italia/lombardia/milano/milano.html" },
  { id: "fb-naples", label: "Naples Vesuvius", lat: 40.8518, lon: 14.2681, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/italia/campania/napoli/napoli.html" },
  { id: "fb-barcelona", label: "Barcelona Port", lat: 41.3765, lon: 2.1775, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/espana/cataluna/barcelona/barcelona.html" },
  { id: "fb-madrid", label: "Madrid Puerta del Sol", lat: 40.4168, lon: -3.7038, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/espana/comunidad-de-madrid/madrid/madrid.html" },
  { id: "fb-lisbon", label: "Lisbon, Portugal", lat: 38.7223, lon: -9.1393, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/portugal/lisboa/lisboa/lisboa.html" },
  { id: "fb-athens", label: "Athens Acropolis", lat: 37.9715, lon: 23.7267, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/ellada/attica/athens/athens.html" },
  { id: "fb-santorini", label: "Santorini, Greece", lat: 36.3932, lon: 25.4615, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/ellada/south-aegean/santorini/santorini.html" },
  { id: "fb-dubrovnik", label: "Dubrovnik, Croatia", lat: 42.6507, lon: 18.0944, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/hrvatska/dubrovacko-neretvanska/dubrovnik/dubrovnik.html" },
  // Middle East / Africa
  { id: "fb-dubai", label: "Dubai Marina", lat: 25.0805, lon: 55.1403, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/united-arab-emirates/dubai/dubai/dubai-marina.html" },
  { id: "fb-istanbul", label: "Istanbul Bosphorus", lat: 41.0082, lon: 28.9784, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/turkiye/istanbul/istanbul/istanbul.html" },
  { id: "fb-jerusalem", label: "Jerusalem Western Wall", lat: 31.7767, lon: 35.2345, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=westernwall" },
  { id: "fb-cairo", label: "Cairo Pyramids", lat: 29.9792, lon: 31.1342, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/egypt/cairo/cairo/pyramids.html" },
  { id: "fb-capetown", label: "Cape Town, South Africa", lat: -33.9249, lon: 18.4241, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/south-africa/western-cape/cape-town/cape-town.html" },
  // Asia
  { id: "fb-shibuya", label: "Shibuya Crossing, Tokyo", lat: 35.6595, lon: 139.7004, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/japan/kanto/tokyo/shibuya-crossing.html" },
  { id: "fb-tokyo-tower", label: "Tokyo Tower", lat: 35.6586, lon: 139.7454, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/japan/kanto/tokyo/tokyo.html" },
  { id: "fb-kyoto", label: "Kyoto, Japan", lat: 35.0116, lon: 135.7681, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/japan/kansai/kyoto/kyoto.html" },
  { id: "fb-seoul", label: "Seoul, South Korea", lat: 37.5665, lon: 126.9780, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/daehan-minguk/seoul/seoul/seoul.html" },
  { id: "fb-beijing", label: "Beijing Forbidden City", lat: 39.9163, lon: 116.3972, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/china/beijing/beijing/beijing.html" },
  { id: "fb-hk", label: "Victoria Harbour, Hong Kong", lat: 22.2934, lon: 114.1694, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/china/hong-kong/hong-kong/victoria-harbour.html" },
  { id: "fb-singapore", label: "Marina Bay, Singapore", lat: 1.2839, lon: 103.8607, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/singapore/central-region/singapore/marina-bay.html" },
  { id: "fb-bangkok", label: "Bangkok, Thailand", lat: 13.7563, lon: 100.5018, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/thailand/bangkok/bangkok/bangkok.html" },
  { id: "fb-mumbai", label: "Mumbai Gateway", lat: 18.9220, lon: 72.8347, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/india/maharashtra/mumbai/mumbai.html" },
  // Oceania + Americas south
  { id: "fb-sydney", label: "Sydney Harbour", lat: -33.8523, lon: 151.2108, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/australia/new-south-wales/sydney/sydney-harbour.html" },
  { id: "fb-melbourne", label: "Melbourne, Australia", lat: -37.8136, lon: 144.9631, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/australia/victoria/melbourne/melbourne.html" },
  { id: "fb-auckland", label: "Auckland, New Zealand", lat: -36.8485, lon: 174.7633, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/new-zealand/auckland/auckland/auckland.html" },
  { id: "fb-rio", label: "Copacabana Beach, Rio", lat: -22.9711, lon: -43.1822, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/brasil/rio-de-janeiro/rio-de-janeiro/copacabana-beach.html" },
  { id: "fb-buenos-aires", label: "Buenos Aires", lat: -34.6037, lon: -58.3816, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/argentina/buenos-aires/buenos-aires/buenos-aires.html" },
  { id: "fb-santiago", label: "Santiago, Chile", lat: -33.4489, lon: -70.6693, kind: "iframe", url: "https://www.skylinewebcams.com/en/webcam/chile/region-metropolitana/santiago/santiago.html" },
];

// Known-embeddable EarthCam feeds (/cams/embed/ pattern allows iframe embedding).
const FALLBACK_WEBCAMS = [
  { id: "ec-times-square",   label: "Times Square, New York",        lat: 40.7580, lon: -73.9855, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=tsrobo1" },
  { id: "ec-vegas-strip",    label: "Las Vegas Strip",               lat: 36.1147, lon: -115.1728,kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=lasvegas_strip" },
  { id: "ec-niagara",        label: "Niagara Falls",                 lat: 43.0962, lon: -79.0377, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=niagarafalls_str" },
  { id: "ec-bourbon",        label: "Bourbon Street, New Orleans",   lat: 29.9584, lon: -90.0653, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=catsmeow" },
  { id: "ec-pier39",         label: "Pier 39, San Francisco",        lat: 37.8087, lon: -122.4098,kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=pier39" },
  { id: "ec-western-wall",   label: "Jerusalem Western Wall",        lat: 31.7767, lon: 35.2345,  kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=westernwall" },
  { id: "ec-abbey-road",     label: "Abbey Road, London",            lat: 51.5320, lon: -0.1779,  kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=abbeyroad" },
  { id: "ec-dublin",         label: "Temple Bar, Dublin",            lat: 53.3455, lon: -6.2644,  kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=templebarpub" },
  { id: "ec-nola-frenchmen", label: "Frenchmen St, New Orleans",     lat: 29.9635, lon: -90.0572, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=frenchmenst" },
  { id: "ec-key-west-sloppy",label: "Sloppy Joes, Key West",         lat: 24.5551, lon: -81.8014, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=sloppyjoes" },
  { id: "ec-beach-fl",       label: "Fort Lauderdale Beach",         lat: 26.1224, lon: -80.1373, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=ftlauderdale" },
  { id: "ec-world-trade",    label: "World Trade Center, NYC",       lat: 40.7127, lon: -74.0134, kind: "iframe", url: "https://www.earthcam.com/cams/embed/?cam=worldtradecenter" },
];

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const KEY = Netlify.env.get("WINDY_API_KEY");
  const store = getStore("darvis-falcon-eye");
  const url = new URL(req.url);
  const near = url.searchParams.get("near"); // "lat,lon"

  if (!KEY) {
    return Response.json({ webcams: FALLBACK_WEBCAMS, source: "fallback" });
  }

  const cacheKey = near ? `webcams:${near}` : "webcams:global";
  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  try {
    let endpoint = "https://api.windy.com/webcams/api/v3/webcams?include=location,player,images&limit=50&lang=en";
    if (near) {
      const [lat, lon] = near.split(",").map((s) => s.trim());
      if (lat && lon) endpoint += `&nearby=${lat},${lon},250`;
    }

    // Windy limits to 50 per page — fetch up to 4 pages so we surface ~200 cams
    const collected = [];
    let offset = 0;
    for (let page = 0; page < 4; page++) {
      const res = await fetch(`${endpoint}&offset=${offset}`, {
        headers: { "x-windy-api-key": KEY },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) break;
      const data = await res.json();
      const page_cams = data.webcams || [];
      if (!page_cams.length) break;
      collected.push(...page_cams);
      offset += page_cams.length;
      if (page_cams.length < 50) break;
    }

    const fromWindy = collected.map((w) => {
      // Windy v3 returns timelapse player URLs keyed by duration.
      // Prefer the shortest window ('day' = last 24 h) since that is closest
      // to real-time. All of these are iframe-embeddable by design.
      const player = w.player || {};
      const embed = player.day || player.month || player.year || player.lifetime;
      if (!embed) return null;
      return {
        id: `windy-${w.webcamId}`,
        label: w.title || "Webcam",
        lat: w.location?.latitude,
        lon: w.location?.longitude,
        kind: "iframe",
        url: embed,
        thumb: w.images?.current?.preview || null,
      };
    }).filter((w) => w && w.lat != null && w.lon != null);

    const merged = [...fromWindy, ...FALLBACK_WEBCAMS];
    const out = { webcams: merged, source: "windy", count: merged.length, ts: Date.now() };
    try { await store.setJSON(cacheKey, { data: out, ts: Date.now() }); } catch {}
    return Response.json(out);
  } catch (e) {
    return Response.json({ webcams: FALLBACK_WEBCAMS, source: "fallback", error: String(e) });
  }
};

export const config = { path: "/api/falcon-eye/webcams" };
