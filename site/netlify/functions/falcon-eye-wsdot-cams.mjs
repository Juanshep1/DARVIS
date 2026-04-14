import { getStore } from "@netlify/blobs";

// WSDOT (Washington State DOT) traffic cameras.
// ~1,800 active JPG snapshot cams that refresh every ~60s. WSDOT does not
// publish HLS, but the snapshots are public (no CORS, no auth on the image
// URLs themselves) and "live enough" for a command center overview.
//
// The JSON listing requires a free WSDOT Traveler Information API access
// code: set WSDOT_ACCESS_CODE in Netlify env vars. Register at:
//   https://wsdot.wa.gov/traffic/api/
//
// If the env var is missing we return an empty set + a soft error so the
// frontend can still render without this source.

const CACHE_MS = 10 * 60 * 1000;
const ENDPOINT = "https://wsdot.wa.gov/traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson";

async function fetchWsdot(accessCode) {
  const r = await fetch(`${ENDPOINT}?AccessCode=${encodeURIComponent(accessCode)}`, {
    headers: { "User-Agent": "FalconEye/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`wsdot ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data)) return [];
  return data.map((c) => {
    if (!c || c.IsActive === false) return null;
    const loc = c.CameraLocation || {};
    const lat = parseFloat(loc.Latitude);
    const lon = parseFloat(loc.Longitude);
    if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) return null;
    const img = c.ImageURL;
    if (!img || typeof img !== "string") return null;
    const road = loc.RoadName ? `${loc.RoadName}${loc.MilePost != null ? " @ MP " + loc.MilePost : ""}` : "";
    const title = c.Title || loc.Description || road || `WSDOT Cam ${c.CameraID}`;
    return {
      id: `wsdot-${c.CameraID}`,
      label: `${title} (WSDOT)`,
      lat, lon,
      kind: "jpg",
      url: img,
      snapshotUrl: img,
      source: "wsdot",
    };
  }).filter(Boolean);
}

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const store = getStore("darvis-falcon-eye");
  try {
    const cached = await store.get("wsdot-cams", { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json(cached.data, { headers: { "X-Cache": "HIT" } });
    }
  } catch {}

  const accessCode = Netlify.env.get("WSDOT_ACCESS_CODE");
  if (!accessCode) {
    return Response.json(
      { cams: [], total: 0, shown: 0, source: "wsdot", ts: Date.now(),
        error: "WSDOT_ACCESS_CODE not set — register free at https://wsdot.wa.gov/traffic/api/ and run: netlify env:set WSDOT_ACCESS_CODE <key>" },
      { status: 200 }
    );
  }

  let cams = [];
  let err = null;
  try { cams = await fetchWsdot(accessCode); }
  catch (e) { err = String(e?.message || e); }

  // Optional ?thin=1 halves the set for low-bandwidth clients.
  const url = new URL(req.url);
  const thin = url.searchParams.get("thin") === "1";
  const out = thin ? cams.filter((_, i) => i % 2 === 0) : cams;

  const payload = { cams: out, total: cams.length, shown: out.length, source: "wsdot", ts: Date.now(), error: err };
  if (!err && cams.length) {
    try { await store.setJSON("wsdot-cams", { data: payload, ts: Date.now() }); } catch {}
  }
  return Response.json(payload);
};

export const config = { path: "/api/falcon-eye/wsdot-cams" };
