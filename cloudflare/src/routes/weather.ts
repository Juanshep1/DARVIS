import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON, kvSetJSON } from "../lib/kv";

const CACHE_MS = 10 * 60 * 1000;

async function geocode(query: string): Promise<{ lat: number; lon: number; name: string; country?: string; admin?: string } | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const d = (await r.json()) as { results?: { latitude: number; longitude: number; name: string; country?: string; admin1?: string }[] };
  if (!d.results?.length) return null;
  const loc = d.results[0];
  return { lat: loc.latitude, lon: loc.longitude, name: loc.name, country: loc.country, admin: loc.admin1 };
}

async function fetchWeather(lat: number, lon: number): Promise<Record<string, unknown>> {
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
  return (await r.json()) as Record<string, unknown>;
}

const WMO: Record<number, [string, string]> = {
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

function describeCode(code: number): [string, string] {
  return WMO[code] || ["Unknown", "🌡"];
}

export const weatherRoute = new Hono<{ Bindings: Env }>();

weatherRoute.get("/", async (c) => {
  let lat = c.req.query("lat") ? parseFloat(c.req.query("lat")!) : NaN;
  let lon = c.req.query("lon") ? parseFloat(c.req.query("lon")!) : NaN;
  let locationName = c.req.query("q") || "";

  if (locationName && (isNaN(lat) || isNaN(lon))) {
    const geo = await geocode(locationName);
    if (!geo) return c.json({ error: `Could not find "${locationName}"` }, 404);
    lat = geo.lat; lon = geo.lon;
    locationName = `${geo.name}, ${geo.admin || ""} ${geo.country || ""}`.trim();
  }
  if (isNaN(lat) || isNaN(lon)) { lat = 32.78; lon = -96.80; locationName = "Dallas, TX (default)"; }

  const cacheKey = `weather:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = await kvGetJSON<{ data: Record<string, unknown>; ts: number }>(c.env, "falcon-eye", cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) {
    const hdrs = new Headers(); hdrs.set("X-Cache", "HIT");
    return new Response(JSON.stringify({ ...cached.data, cached: true }), { headers: { "Content-Type": "application/json", "X-Cache": "HIT" } });
  }

  try {
    const raw = await fetchWeather(lat, lon) as { current: Record<string, number>; daily: Record<string, (number | string)[]>; timezone: string };
    const cur = raw.current;
    const [desc, emoji] = describeCode(cur.weather_code as number);
    const current = {
      temperature: cur.temperature_2m,
      feelsLike: cur.apparent_temperature,
      humidity: cur.relative_humidity_2m,
      windSpeed: cur.wind_speed_10m,
      windGusts: cur.wind_gusts_10m,
      windDirection: cur.wind_direction_10m,
      precipitation: cur.precipitation,
      description: desc, emoji,
      isDay: cur.is_day === 1,
    };
    const daily = raw.daily;
    const forecast: Record<string, unknown>[] = [];
    const times = daily.time as string[];
    for (let i = 0; i < (times?.length || 0); i++) {
      const [dayDesc, dayEmoji] = describeCode((daily.weather_code as number[])[i]);
      forecast.push({
        date: times[i],
        high: (daily.temperature_2m_max as number[])[i],
        low: (daily.temperature_2m_min as number[])[i],
        feelsHigh: (daily.apparent_temperature_max as number[])[i],
        feelsLow: (daily.apparent_temperature_min as number[])[i],
        sunrise: (daily.sunrise as string[])[i],
        sunset: (daily.sunset as string[])[i],
        precipitation: (daily.precipitation_sum as number[])[i],
        precipChance: (daily.precipitation_probability_max as number[])[i],
        windMax: (daily.wind_speed_10m_max as number[])[i],
        description: dayDesc, emoji: dayEmoji,
      });
    }
    const out = { location: locationName, lat, lon, timezone: raw.timezone, current, forecast, ts: Date.now() };
    await kvSetJSON(c.env, "falcon-eye", cacheKey, { data: out, ts: Date.now() });
    return c.json(out);
  } catch (e) {
    return c.json({ error: (e as Error).message || "weather fetch failed" }, 502);
  }
});
