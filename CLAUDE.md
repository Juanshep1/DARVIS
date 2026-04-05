# DARVIS — Claude Code Project Guide

## What this is
D.A.R.V.I.S. (Digital Assistant, Rather Very Intelligent System) — a voice-activated AI assistant with:
- **Terminal app** (`darvis.py`) — macOS/Linux/Android, uses Safari control on Mac
- **Local web dashboard** (`web.py`) — runs on localhost:2414
- **Browser app** (`site/`) — deployed to https://darvis1.netlify.app via Netlify

## Key files
- `darvis.py` — Main terminal assistant (Brain, Ear, ElevenLabsVoice classes, command execution)
- `web.py` — Local web dashboard server
- `memory.py` — Persistent memory (syncs to Netlify Blobs cloud API)
- `history.py` — Conversation history (syncs to Netlify Blobs cloud API)
- `site/public/index.html` — Browser app frontend (vanilla JS, no framework)
- `site/netlify/functions/` — Serverless functions: chat, tts, memory, history, settings, models, voices
- `site/netlify.toml` — Netlify build config
- `.env` — API keys (never commit this)
- `settings.json` — User preferences (never commit this)

## Architecture
- **LLM**: Ollama Cloud API (https://ollama.com/api)
- **TTS**: ElevenLabs API
- **Web search**: Terminal uses DuckDuckGo scraping + Safari. Browser uses Tavily API.
- **Storage**: Netlify Blobs for cross-device memory, history, and settings
- **Cloud URLs**: Memory `https://darvis1.netlify.app/api/memory`, History `/api/history`, Settings `/api/settings`

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
- `DARVIS_MODEL` — Default model (currently glm-5)
- `DARVIS_VOICE_ID` — Default ElevenLabs voice
- `TAVILY_API_KEY` — Tavily web search (browser only)

## Important notes
- The terminal version uses Safari for web browsing. The browser version uses Tavily. Don't mix them.
- Memory and history sync across all devices via Netlify Blobs — any change must go through the cloud API.
- The browser `index.html` is a single self-contained file (inline CSS + JS). No build step.
- Netlify functions use `Netlify.env.get()` not `process.env`.
- The `site/` directory has its own `package.json` for `@netlify/blobs`.
