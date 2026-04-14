export const MARITIME_STORE = "darvis-falcon-eye";
export const VESSEL_SNAPSHOT_KEY = "maritime:vessels:snapshot";
export const VESSEL_SOURCE = "aisstream.io";
export const VESSEL_CACHE_SECONDS = 15;
export const DEFAULT_RETENTION_MS = 60 * 60 * 1000;

const COMMERCIAL_TYPE_CODES = new Set([
  60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
  80, 81, 82, 83, 84, 85, 86, 87, 88, 89,
]);

const FLAG_BY_MID = new Map([
  ["201", "Albania"],
  ["205", "Belgium"],
  ["209", "Cyprus"],
  ["210", "Cyprus"],
  ["211", "Germany"],
  ["212", "Cyprus"],
  ["218", "Germany"],
  ["219", "Denmark"],
  ["220", "Denmark"],
  ["224", "Spain"],
  ["227", "France"],
  ["229", "Malta"],
  ["230", "Finland"],
  ["231", "Faroe Islands"],
  ["232", "United Kingdom"],
  ["235", "United Kingdom"],
  ["236", "Gibraltar"],
  ["237", "Greece"],
  ["238", "Croatia"],
  ["239", "Greece"],
  ["240", "Greece"],
  ["241", "Greece"],
  ["244", "Netherlands"],
  ["246", "Netherlands"],
  ["247", "Italy"],
  ["248", "Malta"],
  ["249", "Malta"],
  ["250", "Ireland"],
  ["255", "Portugal"],
  ["256", "Malta"],
  ["257", "Norway"],
  ["258", "Norway"],
  ["259", "Norway"],
  ["261", "Poland"],
  ["265", "Sweden"],
  ["266", "Sweden"],
  ["267", "Slovakia"],
  ["271", "Turkey"],
  ["273", "Russia"],
  ["308", "Bahamas"],
  ["309", "Bahamas"],
  ["311", "Bahamas"],
  ["316", "Canada"],
  ["338", "United States"],
  ["366", "United States"],
  ["367", "United States"],
  ["368", "United States"],
  ["370", "Panama"],
  ["371", "Panama"],
  ["372", "Panama"],
  ["373", "Panama"],
  ["374", "Panama"],
  ["412", "China"],
  ["413", "China"],
  ["414", "China"],
  ["416", "Taiwan"],
  ["417", "Sri Lanka"],
  ["419", "India"],
  ["422", "Iran"],
  ["431", "Japan"],
  ["432", "Japan"],
  ["440", "South Korea"],
  ["441", "South Korea"],
  ["447", "Kuwait"],
  ["470", "UAE"],
  ["477", "Hong Kong"],
  ["503", "Australia"],
  ["525", "Indonesia"],
  ["533", "Malaysia"],
  ["538", "Marshall Islands"],
  ["563", "Singapore"],
  ["564", "Singapore"],
  ["565", "Singapore"],
  ["566", "Singapore"],
  ["572", "Tuvalu"],
  ["574", "Vietnam"],
  ["576", "Vanuatu"],
  ["577", "Vanuatu"],
  ["601", "South Africa"],
  ["636", "Liberia"],
  ["637", "Liberia"],
]);

function cleanString(value) {
  return typeof value === "string" ? value.replace(/@+/g, " ").replace(/\s+/g, " ").trim() : "";
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function vesselCategoryFromTypeCode(typeCode) {
  const code = toFiniteNumber(typeCode);
  if (code == null) return "unknown";
  if (code >= 60 && code <= 69) return "passenger";
  if (code >= 70 && code <= 79) return "cargo";
  if (code >= 80 && code <= 89) return "tanker";
  return "other";
}

export function isCommercialType(typeCode) {
  const code = toFiniteNumber(typeCode);
  return code != null && COMMERCIAL_TYPE_CODES.has(code);
}

export function deriveFlagFromMmsi(mmsi) {
  const digits = String(mmsi || "").replace(/\D+/g, "");
  if (digits.length < 3) return "";
  return FLAG_BY_MID.get(digits.slice(0, 3)) || "";
}

export function etaToIso(eta, now = new Date()) {
  if (!eta || typeof eta !== "object") return null;
  const month = Number(eta.Month);
  const day = Number(eta.Day);
  const hour = Number(eta.Hour);
  const minute = Number(eta.Minute);
  if (!month || !day || hour > 23 || minute > 59) return null;
  const year = now.getUTCFullYear();
  const iso = new Date(Date.UTC(year, month - 1, day, hour, minute, 0)).toISOString();
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function parseAisTimestamp(value) {
  if (!value) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function normalizeStaticMessage(messageType, body) {
  if (messageType === "ShipStaticData") {
    return {
      mmsi: body?.UserID,
      name: cleanString(body?.Name),
      callsign: cleanString(body?.CallSign),
      destination: cleanString(body?.Destination),
      eta: etaToIso(body?.Eta),
      typeCode: toFiniteNumber(body?.Type),
    };
  }

  if (messageType === "StaticDataReport") {
    return {
      mmsi: body?.UserID,
      name: cleanString(body?.ReportA?.Name),
      callsign: cleanString(body?.ReportB?.CallSign),
      destination: "",
      eta: null,
      typeCode: toFiniteNumber(body?.ReportB?.ShipType),
    };
  }

  return null;
}

export function normalizePositionMessage(messageType, body, metadata) {
  if (!body || typeof body !== "object") return null;
  if (!["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport"].includes(messageType)) return null;

  const mmsi = body.UserID ?? metadata?.MMSI;
  const lat = toFiniteNumber(body.Latitude ?? metadata?.latitude ?? metadata?.Latitude);
  const lon = toFiniteNumber(body.Longitude ?? metadata?.longitude ?? metadata?.Longitude);
  if (!mmsi || lat == null || lon == null) return null;

  return {
    mmsi: String(mmsi),
    lat,
    lon,
    sog: toFiniteNumber(body.Sog),
    cog: toFiniteNumber(body.Cog),
    heading: toFiniteNumber(body.TrueHeading),
    name: cleanString(body.Name || metadata?.ShipName),
    lastSeen: parseAisTimestamp(metadata?.time_utc),
  };
}

export function mergeVesselRecord(previous, update) {
  const next = { ...(previous || {}) };
  for (const [key, value] of Object.entries(update || {})) {
    if (value !== null && value !== undefined && value !== "") next[key] = value;
  }
  next.mmsi = String(next.mmsi || update?.mmsi || previous?.mmsi || "");
  if (!next.flag) next.flag = deriveFlagFromMmsi(next.mmsi);
  if (next.typeCode != null) next.type = vesselCategoryFromTypeCode(next.typeCode);
  if (!next.lastSeen) next.lastSeen = Date.now();
  return next;
}

export function pruneVessels(vessels, retentionMs = DEFAULT_RETENTION_MS, now = Date.now()) {
  const out = {};
  for (const [mmsi, vessel] of Object.entries(vessels || {})) {
    if (!vessel || !vessel.lastSeen) continue;
    if (now - vessel.lastSeen > retentionMs) continue;
    if (typeof vessel.lat !== "number" || typeof vessel.lon !== "number") continue;
    if (vessel.typeCode != null && !isCommercialType(vessel.typeCode)) continue;
    out[mmsi] = {
      ...vessel,
      mmsi: String(mmsi),
      type: vesselCategoryFromTypeCode(vessel.typeCode),
      flag: vessel.flag || deriveFlagFromMmsi(mmsi),
    };
  }
  return out;
}

export function parseBbox(value) {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon > maxLon || minLat > maxLat) return null;
  return { minLon, minLat, maxLon, maxLat };
}

export function withinBbox(vessel, bbox) {
  if (!bbox) return true;
  return vessel.lon >= bbox.minLon && vessel.lon <= bbox.maxLon && vessel.lat >= bbox.minLat && vessel.lat <= bbox.maxLat;
}

export function vesselToFeature(vessel) {
  return {
    type: "Feature",
    id: vessel.mmsi,
    geometry: {
      type: "Point",
      coordinates: [vessel.lon, vessel.lat],
    },
    properties: {
      mmsi: vessel.mmsi,
      name: vessel.name || "",
      callsign: vessel.callsign || "",
      type: vessel.type || "unknown",
      typeCode: vessel.typeCode ?? null,
      flag: vessel.flag || "",
      destination: vessel.destination || "",
      eta: vessel.eta || null,
      sog: vessel.sog ?? null,
      cog: vessel.cog ?? null,
      heading: vessel.heading ?? null,
      lastSeen: vessel.lastSeen,
      source: VESSEL_SOURCE,
    },
  };
}

export function buildFeatureCollection(vessels, meta = {}) {
  const features = Object.values(vessels || {}).map(vesselToFeature);
  return {
    type: "FeatureCollection",
    features,
    meta: {
      count: features.length,
      source: VESSEL_SOURCE,
      generatedAt: Date.now(),
      ...meta,
    },
  };
}
