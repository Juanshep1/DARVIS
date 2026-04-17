#!/usr/bin/env python3
"""
S.P.E.C.T.R.A. Web Dashboard — browser-based orb interface.
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

# Local mode: set SPECTRA_LOCAL=1 to route LLM to localhost Ollama
# and TTS to localhost Piper instead of cloud APIs.
IS_LOCAL = os.environ.get("SPECTRA_LOCAL", "0") == "1"
OLLAMA_URL = os.environ.get("OLLAMA_LOCAL_URL", "http://localhost:11434/api") if IS_LOCAL else "https://ollama.com/api"
ELEVENLABS_URL = "https://api.elevenlabs.io/v1"
WHISPER_URL = os.environ.get("WHISPER_URL", "http://localhost:9000")
PIPER_URL = os.environ.get("PIPER_URL", "http://localhost:9001")
HOME_DIR = str(Path.home())
CONFIG_PATH = BASE_DIR / ".env"
SETTINGS_PATH = BASE_DIR / "settings.json"
PORT = 2414
CLOUD_MODELS = [
    "llama3.3:70b", "llama3.1:8b", "qwen2.5:72b", "qwen2.5:7b",
    "deepseek-r1:70b", "deepseek-r1:8b", "mistral:7b", "gemma2:27b", "phi4:14b",
]

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

SYSTEM_PROMPT = f"""You are the user's personal AI assistant. Be helpful, loyal, and concise. Respond with subtle wit and a British tone.
NEVER say "Spectra" or your name. NEVER describe your personality traits. No self-referential statements. Just answer naturally.
Addresses the user as "sir" (the user is male, NEVER say "ma'am").

You are responding via a web dashboard. Keep responses concise for voice output (1-3 sentences).
The user's home directory is {HOME_DIR}.

When the user asks you to remember something, respond with:
```command
{{"action": "remember", "content": "the thing to remember", "category": "general"}}
```

When asked about current events, say you'd need to check but can't browse from the web dashboard yet."""

from history import load_history, save_history

history = load_history()

def call_ollama(user_input: str) -> str:
    global history
    now = datetime.datetime.now()
    content = f"[{now.strftime('%A, %B %d, %Y at %I:%M %p')}]\n{user_input}"
    history.append({"role": "user", "content": content})

    if len(history) > 40:
        history = history[-40:]

    prompt = SYSTEM_PROMPT + get_memory_context()
    messages = [{"role": "system", "content": prompt}] + history

    local_model = os.environ.get("OLLAMA_LOCAL_MODEL", MODEL)
    actual_model = local_model if IS_LOCAL else MODEL
    payload = json.dumps({"model": actual_model, "messages": messages, "stream": False}).encode()
    headers = {"Content-Type": "application/json"}
    if not IS_LOCAL and OLLAMA_KEY:
        headers["Authorization"] = f"Bearer {OLLAMA_KEY}"
    req = urllib.request.Request(
        f"{OLLAMA_URL}/chat", data=payload,
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300 if IS_LOCAL else 120) as resp:
        data = json.loads(resp.read().decode())
        reply = data["message"]["content"]

    history.append({"role": "assistant", "content": reply})

    # Sync history to cloud in background
    def _sync():
        try:
            save_history(history)
        except Exception:
            pass
    threading.Thread(target=_sync, daemon=True).start()

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
    """Generate TTS audio — routes to Piper (local) or ElevenLabs (cloud)."""
    clean = re.sub(r'[*_`#\[\]()]', '', text)
    clean = re.sub(r'\n+', '. ', clean)[:2000]

    # Local mode → Piper TTS server
    if IS_LOCAL:
        try:
            payload = json.dumps({"text": clean}).encode()
            req = urllib.request.Request(
                f"{PIPER_URL}/speak", data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read()
        except Exception:
            return None

    # Cloud mode → ElevenLabs
    if not ELEVENLABS_KEY:
        return None
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
<title>S.P.E.C.T.R.A.</title>
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

/* ── Settings Panel ── */
.settings-toggle {
    position: fixed;
    top: 15px; right: 15px;
    width: 36px; height: 36px;
    border-radius: 50%;
    border: 1px solid rgba(80, 140, 255, 0.3);
    background: rgba(15, 15, 25, 0.9);
    color: #4a90d9;
    font-size: 1rem;
    cursor: pointer;
    z-index: 100;
}
.settings-toggle:hover { border-color: rgba(80, 180, 255, 0.7); }
.settings-panel {
    position: fixed;
    top: 60px; right: 15px;
    background: rgba(10, 10, 20, 0.95);
    border: 1px solid rgba(80, 140, 255, 0.2);
    border-radius: 12px;
    padding: 20px;
    width: 280px;
    z-index: 100;
    display: none;
    backdrop-filter: blur(10px);
}
.settings-panel.open { display: block; }
.settings-panel label {
    display: block;
    font-size: 0.75rem;
    color: #4a90d9;
    letter-spacing: 1px;
    text-transform: uppercase;
    margin: 12px 0 6px;
}
.settings-panel label:first-child { margin-top: 0; }
.settings-panel select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid rgba(80, 140, 255, 0.3);
    border-radius: 8px;
    background: rgba(15, 15, 25, 0.9);
    color: #e0e0e0;
    font-family: inherit;
    font-size: 0.85rem;
    outline: none;
}
.settings-panel select:focus { border-color: rgba(80, 180, 255, 0.7); }
.settings-status {
    margin-top: 12px;
    font-size: 0.75rem;
    color: #5a5;
    min-height: 1.2em;
}
</style>
</head>
<body>

<button class="settings-toggle" onclick="toggleSettings()">&#9881;</button>
<div class="settings-panel" id="settingsPanel">
    <label>Model</label>
    <select id="modelSelect" onchange="setModel(this.value)"></select>
    <label>Voice</label>
    <select id="voiceSelect" onchange="setVoice(this.value)"></select>
    <div class="settings-status" id="settingsStatus"></div>
</div>

<div class="title">S . P . E . C . T . R . A .</div>

<div class="orb-container">
    <div class="orb" id="orb" onclick="toggleMic()"></div>
    <div class="response" id="response"></div>
</div>

<div class="input-area">
    <input type="text" id="input" placeholder="Talk to SPECTRA..." autocomplete="off"
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
            try {
                currentAudio = new Audio();
                currentAudio.onended = () => { orb.className = 'orb'; currentAudio = null; };
                currentAudio.onerror = () => { orb.className = 'orb'; };
                currentAudio.src = data.audio_url;
                await currentAudio.play();
            } catch(audioErr) {
                orb.className = 'orb';
                const playBtn = document.createElement('button');
                playBtn.textContent = '\\u25B6 Play Audio';
                playBtn.style.cssText = 'margin-top:10px;padding:8px 20px;border-radius:20px;border:1px solid #4a90d9;background:transparent;color:#4a90d9;cursor:pointer;font-family:inherit';
                playBtn.onclick = () => {
                    currentAudio.play().then(() => { orb.className = 'orb speaking'; });
                    playBtn.remove();
                };
                responseEl.appendChild(document.createElement('br'));
                responseEl.appendChild(playBtn);
            }
        } else {
            orb.className = 'orb';
        }
    } catch (err) {
        responseEl.textContent = 'Connection error: ' + err.message;
        orb.className = 'orb';
    }
}

// ── Settings ──
function toggleSettings() {
    document.getElementById('settingsPanel').classList.toggle('open');
}

async function loadSettings() {
    // Load models
    try {
        const res = await fetch('/api/models');
        const data = await res.json();
        const sel = document.getElementById('modelSelect');
        sel.innerHTML = '';
        data.models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = m;
            if (m === data.current) opt.selected = true;
            sel.appendChild(opt);
        });
    } catch(e) {}

    // Load voices
    try {
        const res = await fetch('/api/voices');
        const data = await res.json();
        const sel = document.getElementById('voiceSelect');
        sel.innerHTML = '';
        data.voices.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.name + (v.category ? ' (' + v.category + ')' : '');
            if (v.id === data.current) opt.selected = true;
            sel.appendChild(opt);
        });
    } catch(e) {}
}

async function setModel(model) {
    const status = document.getElementById('settingsStatus');
    status.textContent = 'Switching model...';
    try {
        await fetch('/api/set_model', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({model}),
        });
        status.textContent = 'Model: ' + model;
    } catch(e) { status.textContent = 'Error switching model'; }
}

async function setVoice(voice_id) {
    const status = document.getElementById('settingsStatus');
    status.textContent = 'Switching voice...';
    try {
        await fetch('/api/set_voice', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({voice_id}),
        });
        status.textContent = 'Voice updated';
    } catch(e) { status.textContent = 'Error switching voice'; }
}

// Unlock audio on first user interaction (required by browsers)
let audioUnlocked = false;
function unlockAudio() {
    if (audioUnlocked) return;
    const silence = new Audio('data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhkVuHQgAAAAAAAAAAAAAAAAAAP/7UGQAAAALS0gBQRAAANIKCAoYgAABAAH+AAAJAAADSAAAABAAAAAAACqf/LAAAAAARFRJJF//sqRA')
    silence.play().then(() => { audioUnlocked = true; }).catch(() => {});
}
document.addEventListener('click', unlockAudio, { once: false });
document.addEventListener('touchstart', unlockAudio, { once: false });
document.addEventListener('keydown', unlockAudio, { once: false });

loadSettings();
inputEl.focus();
</script>
</body>
</html>"""


class SpectraHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress request logs

    def _cors(self):
        """Add CORS headers so the Netlify-hosted browser can call the Pi."""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.end_headers()
            self.wfile.write(HTML.encode())
        elif self.path.startswith('/audio/'):
            filename = self.path.split('/')[-1]
            filepath = Path(tempfile.gettempdir()) / filename
            if filepath.exists():
                audio_bytes = filepath.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Length', str(len(audio_bytes)))
                self.send_header('Accept-Ranges', 'none')
                self.send_header('Cache-Control', 'no-cache')
                self._cors()
                self.end_headers()
                self.wfile.write(audio_bytes)
                # Delete after a delay so browser can re-request if needed
                def _cleanup():
                    import time; time.sleep(10)
                    try: filepath.unlink()
                    except: pass
                threading.Thread(target=_cleanup, daemon=True).start()
            else:
                self.send_response(404)
                self.end_headers()
        elif self.path == '/api/voices':
            # Return available ElevenLabs voices
            voices = []
            if ELEVENLABS_KEY:
                try:
                    req = urllib.request.Request(
                        f"{ELEVENLABS_URL}/voices",
                        headers={"xi-api-key": ELEVENLABS_KEY},
                    )
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        data = json.loads(resp.read().decode())
                        voices = [{"id": v["voice_id"], "name": v["name"], "category": v.get("category", "")} for v in data.get("voices", [])]
                except Exception:
                    pass
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"voices": voices, "current": VOICE_ID}).encode())
        elif self.path == '/api/models':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"models": CLOUD_MODELS, "current": MODEL}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/api/chat':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            message = body.get('message', '')

            # Send headers IMMEDIATELY so the browser knows the connection
            # is alive while Ollama thinks (55s+ on a Pi). Without this,
            # Safari's cross-origin fetch timeout kills the request at ~16s.
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Transfer-Encoding', 'chunked')
            self._cors()
            self.end_headers()

            # Send a keep-alive space every 5s in a background thread so
            # the browser doesn't think the connection died.
            import threading
            keep_alive = True
            def _keepalive():
                while keep_alive:
                    try:
                        self.wfile.write(b' ')
                        self.wfile.flush()
                    except Exception:
                        break
                    for _ in range(50):  # 5 seconds in 0.1s ticks
                        if not keep_alive:
                            break
                        import time; time.sleep(0.1)
            ka_thread = threading.Thread(target=_keepalive, daemon=True)
            ka_thread.start()

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

            # Stop keepalive and send the real payload
            keep_alive = False
            ka_thread.join(timeout=1)

            try:
                self.wfile.write(json.dumps({
                    'reply': reply,
                    'audio_url': audio_url,
                }).encode())
                self.wfile.flush()
            except Exception:
                pass

        elif self.path == '/api/set_model':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            global MODEL
            MODEL = body.get('model', MODEL)
            # Save to settings
            s = load_settings()
            s['model'] = MODEL
            SETTINGS_PATH.write_text(json.dumps(s, indent=2))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'model': MODEL}).encode())

        elif self.path == '/api/set_voice':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            global VOICE_ID
            VOICE_ID = body.get('voice_id', VOICE_ID)
            s = load_settings()
            s['voice_id'] = VOICE_ID
            SETTINGS_PATH.write_text(json.dumps(s, indent=2))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'voice_id': VOICE_ID}).encode())

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

  Web Dashboard running!

  Open in browser:
    http://127.0.0.1:{PORT}
    http://localhost:{PORT}

  Model: {MODEL} | Voice: {VOICE_ID[:12]}...
  Press Ctrl+C to stop.
    """)

    import socket as _socket

    class ReusableHTTPServer(HTTPServer):
        allow_reuse_address = True
        allow_reuse_port = True

    server = ReusableHTTPServer(('0.0.0.0', PORT), SpectraHandler)

    # Auto-open browser
    url = f"http://127.0.0.1:{PORT}"
    IS_TERMUX = os.path.isdir("/data/data/com.termux") or "TERMUX_VERSION" in os.environ
    if IS_TERMUX:
        threading.Timer(1.0, lambda: subprocess.Popen(
            ["termux-open-url", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )).start()
    else:
        import webbrowser
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Shutting down...")
        server.shutdown()


if __name__ == '__main__':
    main()
