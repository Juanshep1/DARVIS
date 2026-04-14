import { getStore } from "@netlify/blobs";
import {
  MARITIME_STORE,
  VESSEL_CACHE_SECONDS,
  VESSEL_SNAPSHOT_KEY,
  buildFeatureCollection,
  parseBbox,
  withinBbox,
} from "./falcon-eye-maritime-utils.mjs";

const ALLOWED_TYPES = new Set(["cargo", "tanker", "passenger", "unknown"]);

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const store = getStore(MARITIME_STORE);
  const url = new URL(req.url);
  const bbox = parseBbox(url.searchParams.get("bbox"));
  const type = url.searchParams.get("type");

  if (url.searchParams.has("bbox") && !bbox) {
    return Response.json({ error: "Invalid bbox. Use minLon,minLat,maxLon,maxLat" }, { status: 400 });
  }
  if (type && !ALLOWED_TYPES.has(type)) {
    return Response.json({ error: "Invalid type. Use cargo, tanker, passenger, or unknown" }, { status: 400 });
  }

  try {
    const snapshot = await store.get(VESSEL_SNAPSHOT_KEY, { type: "json" });
    const vesselsByMmsi = snapshot?.meta?.vesselsByMmsi || {};
    const filteredEntries = Object.entries(vesselsByMmsi).filter(([, vessel]) => {
      if (type && vessel.type !== type) return false;
      return withinBbox(vessel, bbox);
    });

    const filtered = Object.fromEntries(filteredEntries);
    const body = buildFeatureCollection(filtered, {
      query: {
        bbox: bbox ? [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat] : null,
        type: type || null,
      },
      snapshotGeneratedAt: snapshot?.meta?.generatedAt || null,
      snapshotAgeMs: snapshot?.meta?.generatedAt ? Math.max(0, Date.now() - snapshot.meta.generatedAt) : null,
      totalSnapshotCount: snapshot?.meta?.count || 0,
    });

    return Response.json(body, {
      headers: {
        "Cache-Control": `public, max-age=${VESSEL_CACHE_SECONDS}`,
      },
    });
  } catch {
    return Response.json(buildFeatureCollection({}, {
      query: {
        bbox: bbox ? [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat] : null,
        type: type || null,
      },
      snapshotGeneratedAt: null,
      snapshotAgeMs: null,
      totalSnapshotCount: 0,
    }), {
      headers: {
        "Cache-Control": `public, max-age=${VESSEL_CACHE_SECONDS}`,
      },
    });
  }
};

export const config = { path: "/api/falcon-eye/vessels" };
