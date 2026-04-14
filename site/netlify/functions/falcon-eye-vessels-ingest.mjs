import { getStore } from "@netlify/blobs";
import {
  DEFAULT_RETENTION_MS,
  MARITIME_STORE,
  VESSEL_SNAPSHOT_KEY,
  buildFeatureCollection,
  isCommercialType,
  mergeVesselRecord,
  normalizePositionMessage,
  normalizeStaticMessage,
  pruneVessels,
} from "./falcon-eye-maritime-utils.mjs";

const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const DEFAULT_WINDOW_MS = 20_000;
const MAX_WINDOW_MS = 25_000;
const SUBSCRIPTION_MESSAGE_TYPES = [
  "PositionReport",
  "ShipStaticData",
  "StaticDataReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
];

function readWindowMs(req) {
  const url = new URL(req.url);
  const requested = Number(url.searchParams.get("window"));
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_WINDOW_MS;
  return Math.min(requested * 1000, MAX_WINDOW_MS);
}

async function loadExistingVessels(store) {
  try {
    const snapshot = await store.get(VESSEL_SNAPSHOT_KEY, { type: "json" });
    return snapshot?.meta?.vesselsByMmsi && typeof snapshot.meta.vesselsByMmsi === "object"
      ? snapshot.meta.vesselsByMmsi
      : {};
  } catch {
    return {};
  }
}

async function drainAisStream({ apiKey, windowMs, seedVessels }) {
  const ws = new WebSocket(AISSTREAM_URL);
  const vessels = { ...seedVessels };

  let totalMessages = 0;
  let positionMessages = 0;
  let staticMessages = 0;
  let parseErrors = 0;
  let socketErrors = [];

  async function readMessageData(data) {
    if (typeof data === "string") return data;
    if (data && typeof data.text === "function") return data.text();
    return String(data || "");
  }

  const finished = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      finish({ vessels, totalMessages, positionMessages, staticMessages, parseErrors, socketErrors });
    }, windowMs);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: SUBSCRIPTION_MESSAGE_TYPES,
      }));
    });

    ws.addEventListener("message", async (event) => {
      totalMessages += 1;
      try {
        const payload = JSON.parse(await readMessageData(event.data));
        if (payload?.error) {
          socketErrors.push(String(payload.error));
          clearTimeout(timer);
          try { ws.close(); } catch {}
          fail(new Error(payload.error));
          return;
        }

        const messageType = payload?.MessageType;
        const body = payload?.Message?.[messageType];
        const metadata = payload?.MetaData || payload?.Metadata || {};

        const staticUpdate = normalizeStaticMessage(messageType, body);
        if (staticUpdate?.mmsi) {
          staticMessages += 1;
          const mmsi = String(staticUpdate.mmsi);
          const merged = mergeVesselRecord(vessels[mmsi], staticUpdate);
          if (merged.typeCode == null || isCommercialType(merged.typeCode)) vessels[mmsi] = merged;
        }

        const positionUpdate = normalizePositionMessage(messageType, body, metadata);
        if (positionUpdate?.mmsi) {
          positionMessages += 1;
          const mmsi = positionUpdate.mmsi;
          const merged = mergeVesselRecord(vessels[mmsi], positionUpdate);
          if (merged.typeCode == null || isCommercialType(merged.typeCode)) vessels[mmsi] = merged;
        }
      } catch {
        parseErrors += 1;
      }
    });

    ws.addEventListener("error", (event) => {
      socketErrors.push(event?.message || "WebSocket error");
    });

    ws.addEventListener("close", () => {
      clearTimeout(timer);
      finish({ vessels, totalMessages, positionMessages, staticMessages, parseErrors, socketErrors });
    });
  });

  return finished;
}

export async function ingestVessels(req) {
  if (!["GET", "POST"].includes(req.method)) return new Response("Method not allowed", { status: 405 });

  const apiKey = Netlify.env.get("AISSTREAM_API_KEY");
  if (!apiKey) {
    return Response.json({
      ok: false,
      error: "AISSTREAM_API_KEY is not configured",
      hint: "Set the Netlify environment variable before running vessel ingest.",
    }, { status: 503 });
  }

  const store = getStore(MARITIME_STORE);
  const windowMs = readWindowMs(req);
  const retentionMs = DEFAULT_RETENTION_MS;

  try {
    const seedVessels = await loadExistingVessels(store);
    const drained = await drainAisStream({ apiKey, windowMs, seedVessels });
    const vesselsByMmsi = pruneVessels(drained.vessels, retentionMs, Date.now());
    const snapshot = buildFeatureCollection(vesselsByMmsi, {
      vesselsByMmsi,
      retainedHours: retentionMs / (60 * 60 * 1000),
      drainedWindowMs: windowMs,
      totalMessages: drained.totalMessages,
      positionMessages: drained.positionMessages,
      staticMessages: drained.staticMessages,
      parseErrors: drained.parseErrors,
      uniqueVessels: Object.keys(vesselsByMmsi).length,
      warnings: drained.socketErrors,
    });

    await store.setJSON(VESSEL_SNAPSHOT_KEY, snapshot);

    return Response.json({
      ok: true,
      count: snapshot.features.length,
      meta: snapshot.meta,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error?.message || "AIS ingest failed",
    }, { status: 500 });
  }
}

export default ingestVessels;

export const config = {
  path: "/api/falcon-eye/vessels-ingest",
};
