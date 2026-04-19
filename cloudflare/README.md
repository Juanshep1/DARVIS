# SPECTRA — Cloudflare Workers backend

Drop-in replacement for the Netlify Functions layer. Every `/api/*` route
from the old `site/netlify/functions/` directory has been ported to a
Hono handler under `src/routes/`.

## One-time setup

```bash
cd cloudflare
npm install

# Log in (opens browser)
npx wrangler login

# Create a KV namespace — all stores (memory, history, settings, wiki,
# agent, falcon-eye caches, scheduler, alerts, macros) share this
# single namespace with prefixed keys.
npx wrangler kv:namespace create SPECTRA
npx wrangler kv:namespace create SPECTRA --preview
```

Paste the two returned IDs into `wrangler.toml` (`id` + `preview_id`).

## Secrets

Set each of these once with `wrangler secret put`:

| Secret | Required? | Purpose |
|---|---|---|
| `OLLAMA_API_KEY` | **yes** (classic mode) | Ollama Cloud chat |
| `GEMINI_API_KEY` | **yes** (Gemini modes) | Gemini Live + vision + query rewrite |
| `TAVILY_API_KEY` | **yes** (web search) | Tavily search in `/api/chat` |
| `ELEVENLABS_API_KEY` | optional | ElevenLabs TTS + voices list |
| `OPENROUTER_API_KEY` | optional | OpenRouter chat |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | optional | Azure Neural TTS |
| `CESIUM_ION_TOKEN` | optional | Falcon Eye 3D globe |
| `WSDOT_ACCESS_CODE` | optional | Falcon Eye WSDOT traffic cams |
| `FIRMS_MAP_KEY` | optional | Falcon Eye active fires (NASA FIRMS) |
| `RAPIDAPI_KEY` | optional | Falcon Eye ADS-B Exchange |

Example:

```bash
npx wrangler secret put OLLAMA_API_KEY
# paste the key when prompted
```

## Deploy

```bash
# Dev locally (localhost:8787)
npm run dev

# Ship
npm run deploy
```

Your worker lives at `https://spectra-api.<account>.workers.dev` (or a
custom route if you bind one).

## Flip the frontend over

The browser UI in `site/public/index.html` reads `localStorage.apiBase`.
Open the SPECTRA page, open DevTools, and run:

```js
spectraSetApiBase("https://spectra-api.<account>.workers.dev");
location.reload();
```

Every `/api/*` fetch now goes to the Worker instead of Netlify. Clear
with `spectraSetApiBase("")`.

Same hook on iOS: `UserDefaults.standard.set("<workers-url>", forKey: "apiBase")` once the iOS app is rewired (currently runs fully
on-device with local keys — no remote API).

## Route map

| Path | File | Notes |
|---|---|---|
| `/api/chat` | `routes/chat.ts` | Ollama + Tavily + memory/history + commands + follow-up |
| `/api/gemini-token` | `routes/gemini-token.ts` | Ephemeral token or raw key fallback |
| `/api/memory`, `/api/history`, `/api/settings` | `routes/memory.ts` etc. | KV-backed CRUD |
| `/api/wiki` | `routes/wiki.ts` | Page + source + index CRUD + natural ingest |
| `/api/tts`, `/tts-edge`, `/tts-stream`, `/tts-azure` | `routes/tts.ts` | ElevenLabs / Google Translate / StreamElements / Azure |
| `/api/weather` | `routes/weather.ts` | Open-Meteo geocode + forecast |
| `/api/vision` | `routes/vision.ts` | Ollama vision model |
| `/api/models`, `/api/voices` | `routes/models.ts`, `voices.ts` | Ollama catalog + ElevenLabs voices |
| `/api/openrouter/chat`, `/models`, `/set-model` | `routes/openrouter.ts` | OpenRouter pass-through |
| `/api/briefing` | `routes/briefing.ts` | Parallel fan-out for morning/evening briefing |
| `/api/situation` | `routes/situation.ts` | Situation room aggregate |
| `/api/commands` | `routes/commands.ts` | Daemon command queue |
| `/api/agent/*` | `routes/agent.ts` | Agent status, screenshot, goal |
| `/api/alerts`, `/api/alerts/triggered` | `routes/alerts.ts` | Alert CRUD + poll |
| `/api/macros` | `routes/macros.ts` | Macro CRUD |
| `/api/scheduler` | `routes/scheduler.ts` | Scheduled task CRUD |
| `/api/falcon-eye/*` | `routes/falcon-eye/*.ts` | Cesium token, state, cams, flights, news, etc. |

## Known gaps

Only two Falcon Eye routes are stubbed:

- **`/api/falcon-eye/vessels-ingest`** — the Netlify version opens a
  60-second WebSocket to `aisstream.io`. Workers has a 50ms/10s CPU
  budget on paid plans; a long-lived WS ingest should run on a dedicated
  VM or Durable Object. The read path (`/api/falcon-eye/vessels`) reads
  from KV so once an external ingester fills the `maritime:vessels:snapshot`
  key the endpoint works.
- **`/api/falcon-eye/vessels-cron`** — same reason, see above.

Everything else is a straight port.
