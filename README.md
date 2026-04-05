# D.A.R.V.I.S.

**Digital Assistant, Rather Very Intelligent System**

A voice-activated AI assistant powered by Ollama Cloud + ElevenLabs TTS. Works on **macOS** and **Android (Termux)**.

## Features

- Voice input + output with ElevenLabs premium voices
- Ollama Cloud LLM brain (llama3.3, deepseek, qwen, etc.)
- Real-time web search + URL fetching
- File & folder creation, moving, copying
- Opens files/folders/URLs in system apps
- Safari browser control (macOS) — click links, read pages, navigate
- Persistent settings (model + voice saved between sessions)
- `/type` and `/listen` modes for flexible input

## Quick Start

### macOS

```bash
pip3 install -r requirements.txt
python3 darvis.py
```

### Android (Termux)

```bash
pkg install python
pip install rich SpeechRecognition
# Install Termux:API app from F-Droid, then:
pkg install termux-api
python darvis.py
```

## Setup

On first run, DARVIS will prompt for:

1. **Ollama Cloud API key** — get one at [ollama.com/settings/keys](https://ollama.com/settings/keys)
2. **ElevenLabs API key** — get one at [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys)

Keys are saved to `.env` (git-ignored).

## Commands

| Command | Action |
|---------|--------|
| `/type` | Pause mic, text-only input |
| `/listen` | Resume microphone listening |
| `/voices` | Interactive voice picker |
| `/voice NAME` | Quick switch voice (e.g. `/voice rachel`) |
| `/help` | Show all commands |
| `goodbye` | Exit |

## Safari Control (macOS only)

Enable: Safari → Settings → Advanced → Show features for web developers → Develop → Allow JavaScript from Apple Events

Then ask DARVIS to click links, read pages, navigate, scroll, type into forms, etc.

## Platform Support

| Feature | macOS | Android (Termux) | Linux |
|---------|-------|-------------------|-------|
| ElevenLabs TTS | afplay | termux-media-player | mpv/ffplay |
| Fallback TTS | `say` | `termux-tts-speak` | `espeak` |
| Voice input | PyAudio + Google | `termux-speech-to-text` | PyAudio + Google |
| Open files | `open` | `termux-open` | `xdg-open` |
| Browser | Safari control | `termux-open-url` | `xdg-open` |
| Safari automation | Full | N/A | N/A |
