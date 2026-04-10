# SPECTRA — Claude Code Project Guide

## What this is
S.P.E.C.T.R.A. (Smart Personal Executive for Cognitive Tasks & Real-time Assistance) — a voice-activated AI assistant with:
- **Terminal app** (`spectra.py`) — macOS/Linux/Android, uses Safari control on Mac
- **Local web dashboard** (`web.py`) — runs on localhost:2414
- **Browser app** (`site/`) — deployed to https://darvis1.netlify.app via Netlify

## Key files
- `spectra.py` — Main terminal assistant (Brain, Ear, ElevenLabsVoice classes, command execution)
- `web.py` — Local web dashboard server
- `memory.py` — Persistent memory (syncs to Netlify Blobs cloud API)
- `history.py` — Conversation history (syncs to Netlify Blobs cloud API)
- `gemini_live.py` — Gemini Live Audio WebSocket client (speech-to-speech)
- `computer_use.py` — Gemini Computer Use agent (Playwright browser automation)
- `site/public/index.html` — Browser app frontend (vanilla JS, no framework)
- `site/netlify/functions/` — Serverless functions: chat, tts, memory, history, settings, models, voices, gemini-token, agent
- `site/netlify.toml` — Netlify build config
- `.env` — API keys (never commit this)
- `settings.json` — User preferences (never commit this)

## Architecture

### Two audio modes (user-selectable)
1. **Classic** (default): Ollama Cloud LLM + ElevenLabs TTS + Google STT — three separate services
2. **Gemini Live Audio**: Gemini 2.5 Flash via WebSocket — single service handles STT+LLM+TTS natively

### Key systems
- **LLM (classic)**: Ollama Cloud API (https://ollama.com/api)
- **LLM+Audio (gemini)**: Gemini Live API via WebSocket (wss://generativelanguage.googleapis.com)
- **TTS (classic)**: ElevenLabs API
- **Web search**: Terminal uses DuckDuckGo + Safari. Browser uses Tavily API.
- **Computer Use**: Gemini Computer Use API + Playwright headless browser (terminal only)
- **Storage**: Netlify Blobs for cross-device memory, history, settings, and agent screenshots
- **Camera**: Browser sends camera frames to Gemini WebSocket in Gemini mode

### Cloud URLs
- Memory: `/api/memory`
- History: `/api/history`
- Settings: `/api/settings` (includes `audio_mode`: "classic" or "gemini")
- Gemini token: `/api/gemini-token`
- Agent status: `/api/agent/status`
- Agent screenshot: `/api/agent/screenshot`
- Agent pending goal: `/api/agent/goal`

## How to deploy after making changes
After editing files, always deploy to Netlify:
```bash
cd site && netlify deploy --prod --dir=public --functions=netlify/functions
```

## How to commit and push
```bash
git add -A && git commit -m "description of changes" && git push origin main
```

## After every task
When the user asks you to fix or change something:
1. Make the code changes
2. Test if possible (curl the API, run python syntax checks)
3. Deploy to Netlify if you changed anything in `site/`
4. Commit and push to GitHub
5. Tell the user what you did

## Environment variables (set in Netlify dashboard)
- `OLLAMA_API_KEY` — Ollama Cloud
- `ELEVENLABS_API_KEY` — ElevenLabs TTS
- `GEMINI_API_KEY` — Gemini Live Audio + Computer Use
- `DARVIS_MODEL` — Default model (currently glm-5)
- `DARVIS_VOICE_ID` — Default ElevenLabs voice
- `TAVILY_API_KEY` — Tavily web search (browser only)

## Important notes
- The terminal version uses Safari for web browsing. The browser version uses Tavily. Don't mix them.
- Memory and history sync across all devices via Netlify Blobs — any change must go through the cloud API.
- The browser `index.html` is a single self-contained file (inline CSS + JS). No build step.
- Netlify functions use `Netlify.env.get()` not `process.env`.
- The `site/` directory has its own `package.json` for `@netlify/blobs`.
- Computer Use (Playwright) can only run on the terminal — Netlify serverless can't run headless browsers.
- Browser can trigger a Computer Use task via `/api/agent/goal` — terminal polls and picks it up.
- Gemini Live Audio uses WebSocket directly from the browser (Netlify can't proxy WebSockets).
- The gemini-token function provides the API key securely to the browser for WebSocket connections.
