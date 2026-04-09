import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const results = {};

  // Fetch all data in parallel
  const [weather, settings, memories, alerts, tasks, agentStatus] = await Promise.allSettled([
    // Weather
    fetch("https://wttr.in/?format=j1", { headers: { "User-Agent": "darvis" }, signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .catch(() => null),
    // Settings
    getStore("darvis-settings").get("current", { type: "json" }).catch(() => null),
    // Memories
    getStore("darvis-memory").get("all", { type: "json" }).catch(() => null),
    // Alerts
    getStore("darvis-alerts").get("all", { type: "json" }).catch(() => null),
    // Scheduled tasks
    getStore("darvis-scheduler").get("tasks", { type: "json" }).catch(() => null),
    // Agent status
    getStore("darvis-agent").get("status", { type: "json" }).catch(() => null),
  ]);

  // Weather
  if (weather.status === "fulfilled" && weather.value) {
    try {
      const w = weather.value;
      const cur = w.current_condition?.[0] || {};
      results.weather = {
        temp_f: cur.temp_F,
        temp_c: cur.temp_C,
        condition: cur.weatherDesc?.[0]?.value || "Unknown",
        humidity: cur.humidity,
        wind_mph: cur.windspeedMiles,
        feels_like_f: cur.FeelsLikeF,
      };
    } catch {
      results.weather = null;
    }
  }

  // Settings
  results.settings = settings.status === "fulfilled" ? settings.value : null;

  // Memory count
  const mems = memories.status === "fulfilled" ? memories.value : null;
  results.memory_count = Array.isArray(mems) ? mems.length : (mems?.memories?.length || 0);

  // Alerts
  const alertList = alerts.status === "fulfilled" ? alerts.value : null;
  results.alerts = Array.isArray(alertList) ? alertList.filter((a) => a.active) : [];
  results.alert_count = results.alerts.length;

  // Tasks
  const taskList = tasks.status === "fulfilled" ? tasks.value : null;
  results.tasks = Array.isArray(taskList) ? taskList.filter((t) => !t.completed).slice(0, 5) : [];
  results.task_count = results.tasks.length;

  // Agent
  results.agent = agentStatus.status === "fulfilled" ? agentStatus.value : { active: false };

  // Time
  results.timestamp = new Date().toISOString();

  return Response.json(results);
};

export const config = { path: "/api/situation" };
