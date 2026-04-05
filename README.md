# D.A.R.V.I.S.

**Digital Assistant, Rather Very Intelligent System**

A voice-activated AI assistant powered by Ollama Cloud + ElevenLabs TTS. Works on **macOS**, **Android (Termux)**, and **Linux**.

## Install (one command)

Open your terminal (or Termux on Android) and paste:

```bash
curl -sL https://raw.githubusercontent.com/Juanshep1/DARVIS/main/install.sh | bash
```

That's it. It installs everything, sets up API keys, and launches DARVIS.

After install, just type `darvis` anytime to start it again.

## Features

- Voice input + output with ElevenLabs premium voices
- Ollama Cloud LLM brain (llama3.3, deepseek, qwen, etc.)
- Real-time web search + URL fetching
- File & folder creation, moving, copying
- Opens files/folders/URLs in system apps
- Safari browser control (macOS) — click links, read pages, navigate
- Native browser support (Android) — opens Chrome/Firefox/default
- Persistent settings (model + voice saved between sessions)
- `/type` and `/listen` modes for flexible input

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

Enable: Safari > Settings > Advanced > Show features for web developers > Develop > Allow JavaScript from Apple Events

Then ask DARVIS to click links, read pages, navigate, scroll, type into forms, etc.

## Platform Support

| Feature | macOS | Android (Termux) | Linux |
|---------|-------|-------------------|-------|
| ElevenLabs TTS | afplay | termux-media-player | mpv/ffplay |
| Fallback TTS | `say` | `termux-tts-speak` | `espeak` |
| Voice input | PyAudio + Google | `termux-speech-to-text` | PyAudio + Google |
| Open files | `open` | `termux-open` | `xdg-open` |
| Browser | Safari control | Native browser | Default browser |
