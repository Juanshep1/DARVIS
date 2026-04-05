#!/usr/bin/env python3
"""
D.A.R.V.I.S. Web Dashboard — browser-based orb interface.
Run alongside or instead of the terminal version.
"""

import os
import sys
import json
import datetime
import urllib.request
import urllib.error
import urllib.parse
import re
import tempfile
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

BASE_DIR = Path(__file__).parent
sys.path.insert(0, str(BASE_DIR))

from memory import get_memory_context, add_memory, forget_memory

# ── Config ────────────────────────────────────────────────────────────────────

OLLAMA_URL = "https://ollama.com/api"
ELEVENLABS_URL = "https://api.elevenlabs.io/v1"
HOME_DIR = str(Path.home())
CONFIG_PATH = BASE_DIR / ".env"
SETTINGS_PATH = BASE_DIR / "settings.json"
PORT = 2414

def load_env():
    env = {}
    if CONFIG_PATH.exists():
        for line in CONFIG_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

def load_settings():
    if SETTINGS_PATH.exists():
        try:
            return json.loads(SETTINGS_PATH.read_text())
        except Exception:
            pass
    return {}

ENV = load_env()
SETTINGS = load_settings()
OLLAMA_KEY = ENV.get("OLLAMA_API_KEY", os.environ.get("OLLAMA_API_KEY", ""))
ELEVENLABS_KEY = ENV.get("ELEVENLABS_API_KEY", os.environ.get("ELEVENLABS_API_KEY", ""))
MODEL = SETTINGS.get("model", "llama3.3:70b")
VOICE_ID = SETTINGS.get("voice_id", "kPtEHAvRnjUJFv7SK9WI")

# ── Brain ─────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = f"""You are D.A.R.V.I.S., a Digital Assistant, Rather Very Intelligent System.
You are dry-witted, efficient, and occasionally sardonic — but always helpful and loyal.
British-accented speech patterns. Concise and direct, but with personality.
Addresses the user as "sir" or "ma'am" naturally. Shows quiet competence.

You are responding via a web dashboard. Keep responses concise for voice output (1-3 sentences).
The user's home directory is {HOME_DIR}.

When the user asks you to remember something, respond with:
```command
{{"action": "remember", "content": "the thing to remember", "category": "general"}}
```

When asked about current events, say you'd need to check but can't browse from the web dashboard yet."""

history = []

def call_ollama(user_input: str) -> str:
    global history
    now = datetime.datetime.now()
    content = f"[{now.strftime('%A, %B %d, %Y at %I:%M %p')}]\n{user_input}"
    history.append({"role": "user", "content": content})

    if len(history) > 40:
        history = history[-40:]

    prompt = SYSTEM_PROMPT + get_memory_context()
    messages = [{"role": "system", "content": prompt}] + history

    payload = json.dumps({"model": MODEL, "messages": messages, "stream": False}).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL}/chat", data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {OLLAMA_KEY}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode())
        reply = data["message"]["content"]

    history.append({"role": "assistant", "content": reply})

    # Handle command blocks
    pattern = r'```command\s*\n(.*?)\n```'
    for match in re.findall(pattern, reply, re.DOTALL):
        try:
            cmd = json.loads(match)
            if cmd.get("action") == "remember" and "content" in cmd:
                add_memory(cmd["content"], cmd.get("category", "general"))
            elif cmd.get("action") == "forget" and "id" in cmd:
                forget_memory(int(cmd["id"]))
        except Exception:
            pass

    clean = re.sub(r'```command\s*\n.*?\n```', '', reply, flags=re.DOTALL).strip()
    return clean


def tts_audio(text: str) -> bytes | None:
    """Generate TTS audio via ElevenLabs, return mp3 bytes."""
    if not ELEVENLABS_KEY:
        return None
    clean = re.sub(r'[*_`#\[\]()]', '', text)
    clean = re.sub(r'\n+', '. ', clean)[:2000]
    try:
        payload = json.dumps({
            "text": clean,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.3},
        }).encode()
        req = urllib.request.Request(
            f"{ELEVENLABS_URL}/text-to-speech/{VOICE_ID}", data=payload,
            headers={"Content-Type": "application/json", "xi-api-key": ELEVENLABS_KEY, "Accept": "audio/mpeg"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except Exception:
        return None


# ── Web Server ────────────────────────────────────────────────────────────────

HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>D.A.R.V.I.S.</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    background: #0a0a0f;
    color: #e0e0e0;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
}

/* ── Orb ── */
.orb-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
}
.orb {
    width: 200px; height: 200px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%,
        rgba(80, 180, 255, 0.9),
        rgba(30, 90, 200, 0.6),
        rgba(10, 20, 60, 0.8));
    box-shadow:
        0 0 60px rgba(50, 140, 255, 0.4),
        0 0 120px rgba(50, 140, 255, 0.2),
        inset 0 0 40px rgba(100, 200, 255, 0.3);
    animation: pulse 4s ease-in-out infinite, float 6s ease-in-out infinite;
    cursor: pointer;
    transition: all 0.3s;
    position: relative;
}
.orb::after {
    content: '';
    position: absolute;
    top: 15%; left: 20%;
    width: 30%; height: 20%;
    background: radial-gradient(ellipse, rgba(255,255,255,0.4), transparent);
    border-radius: 50%;
    filter: blur(4px);
}
.orb.thinking {
    animation: pulse 0.6s ease-in-out infinite, float 6s ease-in-out infinite;
    box-shadow:
        0 0 80px rgba(255, 150, 50, 0.5),
        0 0 160px rgba(255, 150, 50, 0.2),
        inset 0 0 50px rgba(255, 200, 100, 0.3);
    background: radial-gradient(circle at 35% 35%,
        rgba(255, 180, 80, 0.9),
        rgba(200, 100, 30, 0.6),
        rgba(60, 20, 10, 0.8));
}
.orb.speaking {
    animation: speakPulse 0.3s ease-in-out infinite, float 6s ease-in-out infinite;
    box-shadow:
        0 0 80px rgba(80, 255, 150, 0.5),
        0 0 160px rgba(80, 255, 150, 0.2),
        inset 0 0 50px rgba(150, 255, 200, 0.3);
    background: radial-gradient(circle at 35% 35%,
        rgba(80, 255, 160, 0.9),
        rgba(30, 180, 80, 0.6),
        rgba(10, 40, 20, 0.8));
}
@keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
}
@keyframes speakPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
}
@keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
}

/* ── Response ── */
.response {
    position: absolute;
    bottom: 0;
    width: 90%;
    max-width: 600px;
    text-align: center;
    font-size: 1rem;
    color: #b0c4de;
    line-height: 1.6;
    padding: 20px;
    max-height: 200px;
    overflow-y: auto;
}

/* ── Title ── */
.title {
    padding: 30px 0 0;
    font-size: 0.8rem;
    letter-spacing: 4px;
    color: #4a90d9;
    text-transform: uppercase;
}

/* ── Input ── */
.input-area {
    width: 100%;
    padding: 20px;
    display: flex;
    gap: 10px;
    justify-content: center;
    background: linear-gradient(transparent, rgba(0,0,0,0.5));
}
.input-area input {
    width: 100%;
    max-width: 500px;
    padding: 14px 20px;
    border: 1px solid rgba(80, 140, 255, 0.3);
    border-radius: 30px;
    background: rgba(15, 15, 25, 0.9);
    color: #e0e0e0;
    font-family: inherit;
    font-size: 1rem;
    outline: none;
    transition: border-color 0.3s;
}
.input-area input:focus {
    border-color: rgba(80, 180, 255, 0.7);
    box-shadow: 0 0 20px rgba(50, 140, 255, 0.15);
}
.input-area input::placeholder { color: #555; }
.mic-btn {
    width: 48px; height: 48px;
    border-radius: 50%;
    border: 1px solid rgba(80, 140, 255, 0.3);
    background: rgba(15, 15, 25, 0.9);
    color: #4a90d9;
    font-size: 1.2rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s;
}
.mic-btn:hover { border-color: rgba(80, 180, 255, 0.7); }
.mic-btn.recording {
    border-color: #ff4444;
    color: #ff4444;
    animation: pulse 1s infinite;
}
</style>
</head>
<body>

<div class="title">D . A . R . V . I . S .</div>

<div class="orb-container">
    <div class="orb" id="orb" onclick="toggleMic()"></div>
    <div class="response" id="response"></div>
</div>

<div class="input-area">
    <input type="text" id="input" placeholder="Talk to DARVIS..." autocomplete="off"
           onkeydown="if(event.key==='Enter')send()">
    <button class="mic-btn" id="micBtn" onclick="toggleMic()">&#x1F3A4;</button>
</div>

<script>
const orb = document.getElementById('orb');
const responseEl = document.getElementById('response');
const inputEl = document.getElementById('input');
const micBtn = document.getElementById('micBtn');
let recognition = null;
let isRecording = false;
let currentAudio = null;

// Web Speech API
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (e) => {
        const text = e.results[0][0].transcript;
        inputEl.value = text;
        send();
    };
    recognition.onend = () => {
        isRecording = false;
        micBtn.classList.remove('recording');
    };
    recognition.onerror = () => {
        isRecording = false;
        micBtn.classList.remove('recording');
    };
}

function toggleMic() {
    if (!recognition) {
        responseEl.textContent = 'Speech recognition not supported in this browser.';
        return;
    }
    if (isRecording) {
        recognition.stop();
    } else {
        isRecording = true;
        micBtn.classList.add('recording');
        recognition.start();
    }
}

async function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';

    // Stop any playing audio
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }

    orb.className = 'orb thinking';
    responseEl.textContent = '';

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({message: text}),
        });
        const data = await res.json();
        responseEl.textContent = data.reply;

        // Play TTS audio
        if (data.audio_url) {
            orb.className = 'orb speaking';
            currentAudio = new Audio(data.audio_url);
            currentAudio.onended = () => { orb.className = 'orb'; currentAudio = null; };
            currentAudio.onerror = () => { orb.className = 'orb'; };
            currentAudio.play();
        } else {
            orb.className = 'orb';
        }
    } catch (err) {
        responseEl.textContent = 'Connection error: ' + err.message;
        orb.className = 'orb';
    }
}

inputEl.focus();
</script>
</body>
</html>"""


class DarvisHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress request logs

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(HTML.encode())
        elif self.path.startswith('/audio/'):
            # Serve temp audio files
            filename = self.path.split('/')[-1]
            filepath = Path(tempfile.gettempdir()) / filename
            if filepath.exists():
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.end_headers()
                self.wfile.write(filepath.read_bytes())
                try:
                    filepath.unlink()
                except Exception:
                    pass
            else:
                self.send_response(404)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/api/chat':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            message = body.get('message', '')

            try:
                reply = call_ollama(message)
            except Exception as e:
                reply = f"Error: {e}"

            # Generate TTS
            audio_url = None
            try:
                audio_data = tts_audio(reply)
                if audio_data:
                    tmp = tempfile.NamedTemporaryFile(suffix='.mp3', dir=tempfile.gettempdir(), delete=False)
                    tmp.write(audio_data)
                    tmp.close()
                    audio_url = f'/audio/{Path(tmp.name).name}'
            except Exception:
                pass

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'reply': reply,
                'audio_url': audio_url,
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()


def main():
    print(f"""
  ██████╗  █████╗ ██████╗ ██╗   ██╗██╗███████╗
  ██╔══██╗██╔══██╗██╔══██╗██║   ██║██║██╔════╝
  ██║  ██║███████║██████╔╝██║   ██║██║███████╗
  ██║  ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
  ██████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝

  Web Dashboard — http://localhost:{PORT}
  Model: {MODEL} | Voice: {VOICE_ID[:12]}...
  Press Ctrl+C to stop.
    """)

    server = HTTPServer(('0.0.0.0', PORT), DarvisHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Shutting down...")
        server.shutdown()


if __name__ == '__main__':
    main()
