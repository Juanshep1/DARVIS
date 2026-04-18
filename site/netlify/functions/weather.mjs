// Real-time weather via Open-Meteo (free, no API key, no signup).
// Returns current conditions + 7-day forecast for any lat/lon or city name.
//
// GET /api/weather?q=Dallas
// GET /api/weather?lat=32.78&lon=-96.80
// GET /api/weather (uses IP geolocation fallback)

import { getStore } from "@netlify/blobs";

const CACHE_MS = 10 * 60 * 1000; // 10 min

// Geocode a city name to lat/lon via Open-Meteo's geocoding API (also free)
async function geocode(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const d = await r.json();
  if (!d.results?.length) return null;
  const loc = d.results[0];
  return { lat: loc.latitude, lon: loc.longitude, name: loc.name, country: loc.country, admin: loc.admin1 };
}

// Fetch current weather + forecast from Open-Meteo
async function fetchWeather(lat, lon) {
  const params = [
    `latitude=${lat}`,
    `longitude=${lon}`,
    "current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day",
    "daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
    "temperature_unit=fahrenheit",
    "wind_speed_unit=mph",
    "precipitation_unit=inch",
    "forecast_days=7",
    "timezone=auto",
  ].join("&");
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  return r.json();
}

// WMO weather code → human description + emoji
const WMO = {
  0: ["Clear sky", "☀️"], 1: ["Mainly clear", "🌤"], 2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"], 45: ["Fog", "🌫"], 48: ["Rime fog", "🌫"],
  51: ["Light drizzle", "🌦"], 53: ["Moderate drizzle", "🌦"], 55: ["Dense drizzle", "🌧"],
  56: ["Freezing drizzle", "🌨"], 57: ["Heavy freezing drizzle", "🌨"],
  61: ["Slight rain", "🌦"], 63: ["Moderate rain", "🌧"], 65: ["Heavy rain", "🌧"],
  66: ["Freezing rain", "🌨"], 67: ["Heavy freezing rain", "🌨"],
  71: ["Slight snow", "🌨"], 73: ["Moderate snow", "❄️"], 75: ["Heavy snow", "❄️"],
  77: ["Snow grains", "❄️"], 80: ["Slight rain showers", "🌦"], 81: ["Moderate showers", "🌧"],
  82: ["Violent showers", "⛈"], 85: ["Slight snow showers", "🌨"], 86: ["Heavy snow showers", "❄️"],
  95: ["Thunderstorm", "⛈"], 96: ["Thunderstorm + hail", "⛈"], 99: ["Thunderstorm + heavy hail", "⛈"],
};

function describeCode(code) {
  return WMO[code] || ["Unknown", "🌡"];
}

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url);
  let lat = url.searchParams.get("lat");
  let lon = url.searchParams.get("lon");
  let locationName = url.searchParams.get("q") || "";

  // Geocode city name if provided
  if (locationName && (!lat || !lon)) {
    const geo = await geocode(locationName);
    if (!geo) return Response.json({ error: `Could not find "${locationName}"` }, { status: 404 });
    lat = geo.lat;
    lon = geo.lon;
    locationName = `${geo.name}, ${geo.admin || ""} ${geo.country || ""}`.trim();
  }

  // Default fallback — Dallas, TX
  if (!lat || !lon) { lat = 32.78; lon = -96.80; locationName = "Dallas, TX (default)"; }

  lat = parseFloat(lat);
  lon = parseFloat(lon);

  // Cache check
  const store = getStore("darvis-falcon-eye");
  const cacheKey = `weather:${lat.toFixed(2)},${lon.toFixed(2)}`;
  try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached && Date.now() - cached.ts < CACHE_MS) {
      return Response.json({ ...cached.data, cached: true }, { headers: { "X-Cache": "HIT" } });
    }
  } catch (e) {}

  try {
    const raw = await fetchWeather(lat, lon);
    const c = raw.current;
    const [desc, emoji] = describeCode(c.weather_code);

    const current = {
      temperature: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windSpeed: c.wind_speed_10m,
      windGusts: c.wind_gusts_10m,
      windDirection: c.wind_direction_10m,
      precipitation: c.precipitation,
      description: desc,
      emoji,
      isDay: c.is_day === 1,
    };

    const daily = raw.daily;
    const forecast = [];
    for (let i = 0; i < (daily.time?.length || 0); i++) {
      const [dayDesc, dayEmoji] = describeCode(daily.weather_code[i]);
      forecast.push({
        date: daily.time[i],
        high: daily.temperature_2m_max[i],
        low: daily.temperature_2m_min[i],
        feelsHigh: daily.apparent_temperature_max[i],
        feelsLow: daily.apparent_temperature_min[i],
        sunrise: daily.sunrise[i],
        sunset: daily.sunset[i],
        precipitation: daily.precipitation_sum[i],
        precipChance: daily.precipitation_probability_max[i],
        windMax: daily.wind_speed_10m_max[i],
        description: dayDesc,
        emoji: dayEmoji,
      });
    }

    const out = {
      location: locationName,
      lat, lon,
      timezone: raw.timezone,
      current,
      forecast,
      ts: Date.now(),
    };

    try { await store.setJSON(cacheKey, { data: out, ts: Date.now() }); } catch (e) {}
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: e?.message || "weather fetch failed" }, { status: 502 });
  }
};

export const config = { path: "/api/weather" };
