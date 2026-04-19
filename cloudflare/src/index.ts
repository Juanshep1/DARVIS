import { Hono } from "hono";
import type { Env } from "./env";
import { cors } from "./lib/cors";

import { chatRoute } from "./routes/chat";
import { geminiTokenRoute } from "./routes/gemini-token";
import { memoryRoutes } from "./routes/memory";
import { historyRoutes } from "./routes/history";
import { settingsRoutes } from "./routes/settings";
import { wikiRoutes } from "./routes/wiki";
import { ttsRoute, ttsEdgeRoute, ttsStreamRoute, ttsAzureRoute } from "./routes/tts";
import { weatherRoute } from "./routes/weather";
import { visionRoute } from "./routes/vision";
import { modelsRoute } from "./routes/models";
import { voicesRoute } from "./routes/voices";
import { openrouterChatRoute, openrouterModelsRoute, openrouterSetModelRoute } from "./routes/openrouter";
import { briefingRoute } from "./routes/briefing";
import { situationRoute } from "./routes/situation";
import { commandsRoutes } from "./routes/commands";
import { agentRoutes } from "./routes/agent";
import { alertsRoutes } from "./routes/alerts";
import { macrosRoutes } from "./routes/macros";
import { schedulerRoutes } from "./routes/scheduler";
import { falconEyeRoutes } from "./routes/falcon-eye";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors);

app.get("/", (c) => c.text("SPECTRA Workers API — healthy"));
app.get("/health", (c) => c.json({ ok: true, now: new Date().toISOString() }));

// ── Core chat path ─────────────────────────────────────────────────────────
app.route("/api/chat", chatRoute);
app.route("/api/gemini-token", geminiTokenRoute);

// ── Storage (memory / history / settings / wiki) ──────────────────────────
app.route("/api/memory", memoryRoutes);
app.route("/api/history", historyRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/wiki", wikiRoutes);

// ── TTS ────────────────────────────────────────────────────────────────────
app.route("/api/tts", ttsRoute);
app.route("/api/tts-edge", ttsEdgeRoute);
app.route("/api/tts-stream", ttsStreamRoute);
app.route("/api/tts-azure", ttsAzureRoute);

// ── Other providers / helpers ──────────────────────────────────────────────
app.route("/api/weather", weatherRoute);
app.route("/api/vision", visionRoute);
app.route("/api/models", modelsRoute);
app.route("/api/voices", voicesRoute);
app.route("/api/openrouter/chat", openrouterChatRoute);
app.route("/api/openrouter/models", openrouterModelsRoute);
app.route("/api/openrouter/set-model", openrouterSetModelRoute);
app.route("/api/briefing", briefingRoute);
app.route("/api/situation", situationRoute);
app.route("/api/commands", commandsRoutes);
app.route("/api/agent", agentRoutes);
app.route("/api/alerts", alertsRoutes);
app.route("/api/macros", macrosRoutes);
app.route("/api/scheduler", schedulerRoutes);

// ── Falcon Eye (mounted under its own path tree) ───────────────────────────
app.route("/api/falcon-eye", falconEyeRoutes);

// Catch-all 404 — useful for client-side debugging
app.all("*", (c) => c.json({ error: "Not found", path: c.req.path }, 404));

export default app;
