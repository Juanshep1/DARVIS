import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON } from "../lib/kv";

export const situationRoute = new Hono<{ Bindings: Env }>();

situationRoute.get("/", async (c) => {
  const [weather, settings, memories, alerts, tasks, agentStatus] = await Promise.allSettled([
    fetch("https://wttr.in/?format=j1", { headers: { "User-Agent": "spectra" }, signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null),
    kvGetJSON(c.env, "settings", "current"),
    kvGetJSON(c.env, "memory", "all"),
    kvGetJSON(c.env, "alerts", "all"),
    kvGetJSON(c.env, "scheduler", "tasks"),
    kvGetJSON(c.env, "agent", "status"),
  ]);

  const results: Record<string, unknown> = {};

  if (weather.status === "fulfilled" && weather.value) {
    try {
      const w = weather.value as { current_condition?: { temp_F?: string; temp_C?: string; weatherDesc?: { value?: string }[]; humidity?: string; windspeedMiles?: string; FeelsLikeF?: string }[] };
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

  results.settings = settings.status === "fulfilled" ? settings.value : null;
  const mems = memories.status === "fulfilled" ? memories.value : null;
  results.memory_count = Array.isArray(mems) ? mems.length : 0;

  const alertList = alerts.status === "fulfilled" ? alerts.value : null;
  results.alerts = Array.isArray(alertList) ? alertList.filter((a: { active?: boolean }) => a.active) : [];
  results.alert_count = (results.alerts as unknown[]).length;

  const taskList = tasks.status === "fulfilled" ? tasks.value : null;
  results.tasks = Array.isArray(taskList) ? taskList.filter((t: { completed?: boolean }) => !t.completed).slice(0, 5) : [];
  results.task_count = (results.tasks as unknown[]).length;

  results.agent = agentStatus.status === "fulfilled" ? agentStatus.value : { active: false };
  results.timestamp = new Date().toISOString();
  return c.json(results);
});
