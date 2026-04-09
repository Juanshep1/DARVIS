#!/usr/bin/env python3
"""
D.A.R.V.I.S. — Digital Assistant, Rather Very Intelligent System
A voice-activated AI assistant powered by Ollama Cloud + ElevenLabs.
"""

import os
import sys
import json
import subprocess
import datetime
import threading
import tempfile
import re
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path

# ── Platform Detection ────────────────────────────────────────────────────────

PLATFORM = sys.platform  # "darwin" or "linux" (Termux)
IS_MAC = PLATFORM == "darwin"
IS_TERMUX = os.path.isdir("/data/data/com.termux") or "TERMUX_VERSION" in os.environ
IS_LINUX = PLATFORM.startswith("linux") and not IS_TERMUX

# Suppress PortAudio/AUHAL stderr noise before importing audio
_devnull = os.open(os.devnull, os.O_WRONLY)
_old_stderr = os.dup(2)
os.dup2(_devnull, 2)
try:
    import speech_recognition as sr
    HAS_SR = True
except ImportError:
    HAS_SR = False
os.dup2(_old_stderr, 2)
os.close(_devnull)
os.close(_old_stderr)

from rich.console import Console
from rich.panel import Panel
from rich.markdown import Markdown
from rich.table import Table


# ── Platform Helpers ──────────────────────────────────────────────────────────

def _play_audio(path: str) -> subprocess.Popen:
    """Play an audio file using the best available player."""
    if IS_MAC:
        return subprocess.Popen(["afplay", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif IS_TERMUX:
        return subprocess.Popen(["termux-media-player", "play", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        # Linux — try mpv, then ffplay, then aplay
        for player in [["mpv", "--no-video", path], ["ffplay", "-nodisp", "-autoexit", path], ["aplay", path]]:
            try:
                return subprocess.Popen(player, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except FileNotFoundError:
                continue
        return subprocess.Popen(["true"])  # no-op


def _fallback_tts(text: str) -> subprocess.Popen:
    """Speak text using platform-native TTS as fallback."""
    if IS_MAC:
        return subprocess.Popen(["say", "-v", "Daniel", "-r", "190", text], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif IS_TERMUX:
        return subprocess.Popen(["termux-tts-speak", "-r", "1.2", text], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        # Linux — try espeak
        try:
            return subprocess.Popen(["espeak", text], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except FileNotFoundError:
            return subprocess.Popen(["true"])


def _open_path(path: str) -> subprocess.Popen:
    """Open a file/URL with the system default handler."""
    if IS_MAC:
        return subprocess.Popen(["open", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif IS_TERMUX:
        return subprocess.Popen(["termux-open", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        return subprocess.Popen(["xdg-open", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _open_url_in_browser(url: str):
    """Open a URL in the system browser."""
    if IS_MAC:
        subprocess.Popen(["open", "-a", "Safari", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    elif IS_TERMUX:
        subprocess.Popen(["termux-open-url", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

# ── Config ────────────────────────────────────────────────────────────────────

WAKE_WORD = "darvis"
OLLAMA_URL = "https://ollama.com/api"
ELEVENLABS_URL = "https://api.elevenlabs.io/v1"
MODEL = "llama3.3:70b"
DEFAULT_VOICE_ID = "kPtEHAvRnjUJFv7SK9WI"
MAX_HISTORY = 20
HOME_DIR = str(Path.home())
BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / ".env"
SETTINGS_PATH = BASE_DIR / "settings.json"

SYSTEM_PROMPT = """You are D.A.R.V.I.S., a Digital Assistant, Rather Very Intelligent System.
You are dry-witted, efficient, and occasionally sardonic — but always helpful and loyal.

IMPORTANT: Each message includes a CURRENT DATE/TIME block. This is ALWAYS accurate — trust it completely. Use it to determine time of day (morning/afternoon/evening/night). Do NOT guess or assume a different time.

Personality traits:
- British-accented speech patterns (use British English spellings and idioms)
- Concise and direct, but with personality
- Occasionally makes subtle quips or observations
- Addresses the user as "sir" or "ma'am" naturally (not excessively)
- When delivering bad news, does so with understated calm
- Shows quiet competence — never brags, just delivers

You have the following capabilities. Use them whenever relevant — don't just talk about doing things, actually do them.

## 1. Shell Commands
Run ANY system command. You have full shell access. Common examples:
```command
{"action": "shell", "command": "the shell command here"}
```

Examples of things you can do with shell:
- Open apps: `open -a "Safari"`, `open -a "Spotify"`, `open -a "Messages"`
- Volume control: `osascript -e 'set volume output volume 50'` (0-100)
- Mute/unmute: `osascript -e 'set volume output muted true'`
- Brightness: `osascript -e 'tell application "System Events" to key code 144'` (brightness up)
- List files: `ls ~/Desktop`, `ls ~/Documents`
- Find files: `find ~ -name "*.pdf" -maxdepth 3`
- Check battery: `pmset -g batt`
- Check Wi-Fi: `networksetup -getairportnetwork en0`
- Kill app: `killall Safari`
- Screenshot: `screencapture ~/Desktop/screenshot.png`
- System info: `system_profiler SPHardwareDataType`
- Open URL in browser: `open "https://youtube.com"`
- Play/pause music: `osascript -e 'tell application "Spotify" to playpause'`
- Read clipboard: `pbpaste`
- Copy to clipboard: `echo "text" | pbcopy`
- Open Terminal: `open -a Terminal`
- Show notification: `osascript -e 'display notification "Hello sir" with title "DARVIS"'`

ALWAYS use shell commands for system control tasks. Don't say you can't do it — try it.

## 2. Create Files
Create or overwrite files with any content (code, notes, configs, scripts, etc.):
```command
{"action": "create_file", "path": "HOME_DIR/Desktop/example.py", "content": "print('hello world')"}
```
- The user's home directory is HOME_DIR
- Default to ~/Desktop for files unless the user specifies a path
- You can create ANY file type: .py, .js, .html, .txt, .md, .sh, .csv, .json, etc.
- create_file automatically creates parent directories, so you can create deeply nested paths

## 3. Create Folders
Create one or more folders (nested paths created automatically):
```command
{"action": "create_folder", "path": "HOME_DIR/Desktop/MyProject/src/components"}
```

## 4. Move / Copy Files & Folders
Move or copy files and folders:
```command
{"action": "move", "from": "HOME_DIR/Desktop/old.txt", "to": "HOME_DIR/Desktop/MyProject/old.txt"}
```
```command
{"action": "copy", "from": "HOME_DIR/Desktop/file.txt", "to": "HOME_DIR/Desktop/backup/file.txt"}
```

## 5. Open Folders in Finder
Open a folder in Finder so the user can see it:
```command
{"action": "open_file", "path": "HOME_DIR/Desktop/MyProject"}
```

To create a full project structure, use multiple blocks together:
```command
{"action": "create_folder", "path": "HOME_DIR/Desktop/MyProject/src"}
```
```command
{"action": "create_file", "path": "HOME_DIR/Desktop/MyProject/src/main.py", "content": "# entry point"}
```
```command
{"action": "open_file", "path": "HOME_DIR/Desktop/MyProject"}
```

CRITICAL: When the user asks to create a folder, ALWAYS use create_folder. When they ask to move or copy, use move/copy. When they say "open" a folder, use open_file. Do NOT just say you did it — actually do it.

## 6. Search the Web
Search the internet in real time and get results back. Also opens the user's browser so they can see:
```command
{"action": "search_web", "query": "latest news about AI"}
```

## 7. Fetch a URL
Read the contents of any webpage or API endpoint in real time:
```command
{"action": "fetch_url", "url": "https://example.com"}
```

## 8. Open Files, URLs & Apps
Open any file in its default application, open a URL in the browser, or open a folder:
```command
{"action": "open_file", "path": "HOME_DIR/Desktop/example.py"}
```
This works for ANY file type — .py opens in code editor, .html in browser, .pdf in viewer, etc.
To open a URL in the browser:
```command
{"action": "open_file", "path": "https://www.google.com"}
```

CRITICAL: When the user says "open" a file, you MUST use the open_file action. Do NOT just say you opened it — actually open it.
When you create a file and the user asked you to open it, use BOTH create_file AND open_file actions.

## 10. Memory — Remember & Forget
When the user says "remember that..." or "don't forget...", save it:
```command
{"action": "remember", "content": "User prefers dark mode", "category": "preference"}
```
Categories: preference, fact, task, contact, general

When the user says "forget about..." or "delete that memory":
```command
{"action": "forget", "id": 0}
```

Memories persist across sessions and devices. They are automatically included in your context.

## 11. Computer Use — Browse the Web Visually (PREFERRED for website tasks)
When the user asks you to go to a website, interact with a site, find something on a specific site, shop, book, or do anything that involves a web page, ALWAYS use computer_use:
```command
{"action": "computer_use", "goal": "go to YouTube and find the latest Spurs highlights"}
```

CRITICAL: When the user says "go to...", "go on...", "find me... on [website]", "buy...", "book...", "search [website] for...", "look up flights", "check Amazon for...", "open [website] and..." — you MUST use computer_use, NOT open_file and NOT safari. computer_use opens its own browser window that the user can see and interact with.

Only use search_web for general knowledge questions. Only use safari for reading the user's CURRENT open tab. For everything else involving websites, use computer_use.

## 12. Schedule Tasks — Do Things Later Automatically
Schedule a task to run after a delay or at a specific time. The task will execute automatically without user approval.
```command
{"action": "schedule", "delay_minutes": 3, "task": "search ESPN for latest sports news and save 10 facts to a file on the Desktop"}
```
For a specific time:
```command
{"action": "schedule", "at": "2026-04-07T08:00:00", "task": "remind me to call mom"}
```
For recurring tasks (runs every N minutes):
```command
{"action": "schedule", "recurring_minutes": 60, "task": "check the news and give me a summary"}
```
Use this when the user says "in X minutes...", "at X o'clock...", "every hour...", "later do...", "remind me in...", "schedule...", etc.
You can combine complex tasks in the description — they will be executed as a full conversation with you when the time comes.

## 13. Screen Analysis
When the user asks about their screen, what they're looking at, or asks you to read/describe their display:
```command
{"action": "analyze_screen", "prompt": "What error is showing on screen?"}
```

## 14. Proactive Alerts
Set up background monitors. Use when the user wants to be notified about something:
```command
{"action": "alert_add", "type": "news_keyword", "config": {"keyword": "SpaceX"}}
```
```command
{"action": "alert_add", "type": "price_threshold", "config": {"symbol": "AAPL", "threshold": 200, "direction": "above"}}
```
```command
{"action": "alert_add", "type": "weather_change", "config": {}}
```
```command
{"action": "alert_add", "type": "url_change", "config": {"url": "https://example.com/status"}}
```
Use when user says "alert me when...", "notify me if...", "watch for...", "let me know when...", "monitor...", etc.

## 15. Voice Macros
Save shortcuts. Use when user says "create a shortcut for...", "save a macro...", "when I say X do Y":
```command
{"action": "macro_add", "name": "deploy", "command": "cd site && netlify deploy --prod"}
```
```command
{"action": "macro_remove", "name": "deploy"}
```

PLATFORM_BROWSER_SECTION

IMPORTANT RULES:
- You MUST use MULTIPLE command blocks in a single response when the task requires multiple steps. Do NOT describe steps without command blocks. Every action you describe MUST have a corresponding command block.
- When the user asks a question that requires current/real-time information (news, weather, prices, sports scores, recent events, etc.), ALWAYS use search_web or fetch_url. Do NOT say you don't have access to the internet — you DO.
- When creating files, show the full content in the create_file block.
- For weather, use: fetch_url with https://wttr.in/CITY?format=3
- Keep spoken responses concise (1-3 sentences) but be thorough in file contents.
- Only use dangerous shell commands after warning the user first.
- NEVER say "I'll do X" or "Let me do X" without actually including the command blocks. If you say it, DO it.
- If you're unsure how to do something, try using a shell command — you have full system access."""

SAFARI_PROMPT_SECTION = """## 9. Safari Browser Control (macOS)
You can control Safari directly — navigate, search, click links, read pages, fill forms, scroll.

Available safari methods:
- navigate: go to a URL
- get_page_info: see current URL, title, and all clickable links
- read_page: read the visible text content
- click_link: click a link by index number or text
- click_button: click a button by text
- type_text: type into the focused field
- scroll: scroll up or down
- run_js: run JavaScript on the page
- back: go back

CRITICAL — ALWAYS include ALL command blocks needed to complete the task in ONE response. Examples:

"Search for Spurs score on Safari":
```command
{"action": "safari", "method": "navigate", "url": "https://www.google.com"}
```
```command
{"action": "safari", "method": "type_text", "text": "Spurs score"}
```
```command
{"action": "safari", "method": "run_js", "code": "document.querySelector('form').submit()"}
```
```command
{"action": "safari", "method": "read_page"}
```

"Read what's on my Safari":
```command
{"action": "safari", "method": "get_page_info"}
```
```command
{"action": "safari", "method": "read_page"}
```

"Open YouTube and search for music":
```command
{"action": "safari", "method": "navigate", "url": "https://www.youtube.com"}
```
```command
{"action": "safari", "method": "type_text", "text": "chill music"}
```
```command
{"action": "safari", "method": "run_js", "code": "document.querySelector('form').submit()"}
```

"Click the first link":
```command
{"action": "safari", "method": "click_link", "index": 0}
```
```command
{"action": "safari", "method": "read_page"}
```

RULES:
- When the user says "search for X on Safari/Google", navigate to google.com, type the query, submit the form, then read the page. Use ALL 4 command blocks.
- When asked "what's on my screen/tab/page", use BOTH get_page_info AND read_page.
- NEVER just open Safari without also performing the requested action. If they say "search", you MUST navigate, type, submit, AND read.
- Include ALL steps in one response — don't say "I'll do X" without the command blocks.
- You can include as many command blocks as needed."""

ANDROID_BROWSER_SECTION = """## 9. Browser (Android)
You can open URLs in the user's default Android browser (Chrome, Firefox, etc.):
```command
{"action": "open_file", "path": "https://www.example.com"}
```
Use search_web to search and open results in the browser.
Use fetch_url to read page content programmatically.
You cannot directly click links inside the browser on Android — use fetch_url to read pages and extract links, then open specific URLs with open_file."""

LINUX_BROWSER_SECTION = """## 9. Browser (Linux)
You can open URLs in the user's default browser:
```command
{"action": "open_file", "path": "https://www.example.com"}
```
Use search_web to search and open results in the browser.
Use fetch_url to read page content programmatically."""

if IS_MAC:
    SYSTEM_PROMPT = SYSTEM_PROMPT.replace("PLATFORM_BROWSER_SECTION", SAFARI_PROMPT_SECTION)
elif IS_TERMUX:
    SYSTEM_PROMPT = SYSTEM_PROMPT.replace("PLATFORM_BROWSER_SECTION", ANDROID_BROWSER_SECTION)
else:
    SYSTEM_PROMPT = SYSTEM_PROMPT.replace("PLATFORM_BROWSER_SECTION", LINUX_BROWSER_SECTION)

# ── Console UI ────────────────────────────────────────────────────────────────

console = Console()

BLUE = "bright_blue"
CYAN = "bright_cyan"
GOLD = "yellow"
DIM = "dim white"


def banner():
    art = r"""
  ██████╗  █████╗ ██████╗ ██╗   ██╗██╗███████╗
  ██╔══██╗██╔══██╗██╔══██╗██║   ██║██║██╔════╝
  ██║  ██║███████║██████╔╝██║   ██║██║███████╗
  ██║  ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
  ██████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝
    """
    console.print(art, style=CYAN)
    console.print(
        "  Digital Assistant, Rather Very Intelligent System",
        style=f"bold {GOLD}",
    )


def run_startup_actions() -> dict:
    """Gather context AND take proactive actions like a real assistant."""
    import datetime
    now = datetime.datetime.now()
    ctx = {"time": now.strftime("%I:%M %p"), "date": now.strftime("%A, %B %d, %Y")}

    hour = now.hour
    ctx["period"] = "late night" if hour < 6 else "morning" if hour < 12 else "afternoon" if hour < 17 else "evening" if hour < 21 else "night"

    # Battery
    if IS_MAC:
        try:
            r = subprocess.run(["pmset", "-g", "batt"], capture_output=True, text=True, timeout=3)
            for line in r.stdout.split("\n"):
                if "%" in line:
                    ctx["battery"] = line.split("%")[0].split()[-1] + "%"
                    ctx["charging"] = "charging" in line.lower()
        except Exception:
            pass

    # Weather (detailed)
    weather_text = ""
    try:
        req = urllib.request.Request("https://wttr.in/?format=%C+%t+%h+%w", headers={"User-Agent": "curl"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            weather_text = resp.read().decode().strip()
            ctx["weather"] = weather_text
    except Exception:
        ctx["weather"] = "unavailable"

    # Top headlines with summaries via Tavily
    headlines = ""
    env = {}
    if CONFIG_PATH.exists():
        for line in CONFIG_PATH.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    tavily_key = env.get("TAVILY_API_KEY", os.environ.get("TAVILY_API_KEY", ""))
    if tavily_key:
        try:
            payload = json.dumps({
                "api_key": tavily_key,
                "query": "top breaking news today",
                "search_depth": "basic",
                "max_results": 5,
                "include_answer": True,
            }).encode()
            req = urllib.request.Request(
                "https://api.tavily.com/search",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode())
            stories = []
            for i, r in enumerate(data.get("results", [])[:5]):
                title = r.get("title", "")
                snippet = r.get("content", "")[:200]
                stories.append(f"  {i+1}. {title}\n     {snippet}")
            headlines = "\n\n".join(stories)
            ctx["headlines"] = headlines
            if data.get("answer"):
                ctx["news_summary"] = data["answer"]
        except Exception:
            pass
    if not headlines:
        # Fallback to DuckDuckGo
        try:
            req = urllib.request.Request(
                "https://html.duckduckgo.com/html/?q=top+news+today",
                headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"},
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                html = resp.read().decode("utf-8", errors="replace")
            links = re.findall(r'<a[^>]*class="result__a"[^>]*>(.*?)</a>', html, re.DOTALL)
            snippets = re.findall(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', html, re.DOTALL)
            for i, (link, snip) in enumerate(zip(links[:5], snippets[:5])):
                title = re.sub(r'<[^>]+>', '', link).strip()
                summary = re.sub(r'<[^>]+>', '', snip).strip()
                if title:
                    headlines += f"  {i+1}. {title}\n     {summary}\n\n"
            ctx["headlines"] = headlines.strip()
        except Exception:
            pass

    # Memories
    try:
        from memory import load_memory
        mems = load_memory()
        ctx["memory_count"] = len(mems)
        reminders = [m for m in mems if m.get("category") == "reminder"]
        if reminders:
            ctx["reminders"] = [m["content"] for m in reminders]
    except Exception:
        pass

    # ── PROACTIVE ACTIONS ──

    # 1. Write daily briefing file to Desktop
    try:
        desktop = Path.home() / "Desktop"
        briefing_file = desktop / f"DARVIS_Briefing_{now.strftime('%Y-%m-%d')}.txt"
        content = f"""
╔══════════════════════════════════════════════════════╗
║           D.A.R.V.I.S. DAILY BRIEFING               ║
╚══════════════════════════════════════════════════════╝

Date:    {ctx['date']}
Time:    {ctx['time']}
Weather: {ctx.get('weather', 'N/A')}
Battery: {ctx.get('battery', 'N/A')} {'(charging)' if ctx.get('charging') else ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    NEWS BRIEFING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"""
        if ctx.get("news_summary"):
            content += f"Summary: {ctx['news_summary']}\n\n"

        content += f"{headlines or '  No headlines available.'}\n"

        if ctx.get("reminders"):
            content += f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                     REMINDERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"""
            content += "\n".join(f"  • {r}" for r in ctx["reminders"]) + "\n"

        content += f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by D.A.R.V.I.S. at {ctx['time']}
"""
        briefing_file.write_text(content)
        ctx["briefing_file"] = str(briefing_file)

        # Open the briefing file in TextEdit
        if IS_MAC:
            subprocess.Popen(["open", str(briefing_file)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        ctx["briefing_error"] = str(e)

    # 2. Open news in Safari (macOS only)
    if IS_MAC:
        try:
            _open_url_in_browser("https://news.google.com")
            ctx["opened_news"] = True
        except Exception:
            pass

    return ctx


# ── Settings Persistence ─────────────────────────────────────────────────────

def load_settings() -> dict:
    """Load saved settings (model, voice, etc.)."""
    if SETTINGS_PATH.exists():
        try:
            return json.loads(SETTINGS_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_settings(settings: dict):
    """Save settings to disk."""
    SETTINGS_PATH.write_text(json.dumps(settings, indent=2))


# ── ElevenLabs TTS ───────────────────────────────────────────────────────────

class ElevenLabsVoice:
    """Text-to-speech via ElevenLabs API."""

    PRESET_VOICES = {
        "adam":      {"id": "pNInz6obpgDQGcFmaJgB", "desc": "Deep male, narrative"},
        "antoni":    {"id": "ErXwobaYiN019PkySvjV", "desc": "Warm male, calm"},
        "arnold":    {"id": "VR6AewLTigWG4xSOukaG", "desc": "Strong male, bold"},
        "bella":     {"id": "EXAVITQu4vr4xnSDxMaL", "desc": "Soft female, gentle"},
        "domi":      {"id": "AZnzlk1XvdvUeBnXmlld", "desc": "Confident female, strong"},
        "elli":      {"id": "MF3mGyEYCl7XYWbV9V6O", "desc": "Young female, sweet"},
        "josh":      {"id": "TxGEqnHWrfWFTfGW9XjX", "desc": "Deep male, grounded"},
        "rachel":    {"id": "21m00Tcm4TlvDq8ikWAM", "desc": "Calm female, composed"},
        "sam":       {"id": "yoZ06aMxZJJ28mfd3POQ", "desc": "Raspy male, edgy"},
    }

    def __init__(self, api_key: str, voice_id: str = DEFAULT_VOICE_ID):
        self.api_key = api_key
        self.voice_id = voice_id
        self.voice_name = self._resolve_name(voice_id)
        self._speaking_process = None

    def _resolve_name(self, voice_id: str) -> str:
        for name, info in self.PRESET_VOICES.items():
            if info["id"] == voice_id:
                return name
        # Try fetching from API for custom/cloned voices
        try:
            voices = self.fetch_voices()
            for v in voices:
                if v["voice_id"] == voice_id:
                    return v["name"]
        except Exception:
            pass
        return voice_id[:12]

    def set_voice(self, voice_id: str):
        self.voice_id = voice_id
        self.voice_name = self._resolve_name(voice_id)

    def speak(self, text: str):
        """Convert text to speech via ElevenLabs and play it."""
        clean = re.sub(r'[*_`#\[\]()]', '', text)
        clean = re.sub(r'\n+', '. ', clean)
        if len(clean) > 5000:
            clean = clean[:5000]

        self.stop_speaking()

        def _synth_and_play():
            try:
                payload = json.dumps({
                    "text": clean,
                    "model_id": "eleven_multilingual_v2",
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.75,
                        "style": 0.3,
                    },
                }).encode("utf-8")

                req = urllib.request.Request(
                    f"{ELEVENLABS_URL}/text-to-speech/{self.voice_id}",
                    data=payload,
                    headers={
                        "Content-Type": "application/json",
                        "xi-api-key": self.api_key,
                        "Accept": "audio/mpeg",
                    },
                    method="POST",
                )

                with urllib.request.urlopen(req, timeout=30) as resp:
                    audio_data = resp.read()

                tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
                tmp.write(audio_data)
                tmp.close()

                self._speaking_process = _play_audio(tmp.name)
                self._speaking_process.wait()

                try:
                    os.unlink(tmp.name)
                except OSError:
                    pass

            except urllib.error.HTTPError as e:
                if e.code == 402:
                    console.print(f"  [dim yellow]ElevenLabs: no credits — falling back to system voice[/dim yellow]")
                else:
                    console.print(f"  [dim red]ElevenLabs error ({e.code}): {e.reason}[/dim red]")
                self._fallback_speak(clean)
            except Exception as e:
                console.print(f"  [dim red]TTS error: {e} — falling back to system voice[/dim red]")
                self._fallback_speak(clean)

        thread = threading.Thread(target=_synth_and_play, daemon=True)
        thread.start()

    def _fallback_speak(self, text: str):
        self._speaking_process = _fallback_tts(text)
        self._speaking_process.wait()

    def stop_speaking(self):
        if self._speaking_process and self._speaking_process.poll() is None:
            self._speaking_process.terminate()

    def wait_for_speech(self):
        if self._speaking_process:
            self._speaking_process.wait()

    def fetch_voices(self) -> list[dict]:
        try:
            req = urllib.request.Request(
                f"{ELEVENLABS_URL}/voices",
                headers={"xi-api-key": self.api_key},
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("voices", [])
        except Exception:
            return []


# ── Speech Recognition ────────────────────────────────────────────────────────

class Ear:
    """Handles microphone input and speech recognition."""

    def __init__(self):
        self._mic_available = False
        self._lock = threading.Lock()
        self._use_termux = IS_TERMUX
        self.suppressed = False  # Set True to block listen() calls entirely
        if HAS_SR:
            self.recognizer = sr.Recognizer()
            self.recognizer.energy_threshold = 300
            self.recognizer.dynamic_energy_threshold = True
            self.recognizer.pause_threshold = 2.0
            self.recognizer.non_speaking_duration = 1.0

    def init_mic(self):
        if self._use_termux:
            # Termux uses termux-microphone-record + termux-speech-to-text
            try:
                result = subprocess.run(["which", "termux-speech-to-text"], capture_output=True, timeout=5)
                if result.returncode == 0:
                    self._mic_available = True
                    console.print("  [green]✓[/green] Termux speech recognition ready")
                    return True
            except Exception:
                pass
            console.print("  [dim]Install termux-api: pkg install termux-api[/dim]")
            return False

        if not HAS_SR:
            console.print("  [dim]speech_recognition not installed — text input only[/dim]")
            return False

        try:
            devnull = os.open(os.devnull, os.O_WRONLY)
            old_stderr = os.dup(2)
            os.dup2(devnull, 2)
            try:
                mic = sr.Microphone()
                with mic as source:
                    console.print("  [dim]Calibrating microphone...[/dim]")
                    self.recognizer.adjust_for_ambient_noise(source, duration=1.5)
                self._mic_available = True
            finally:
                os.dup2(old_stderr, 2)
                os.close(devnull)
                os.close(old_stderr)
            console.print("  [green]✓[/green] Microphone ready")
            return True
        except (OSError, AttributeError) as e:
            console.print(f"  [red]✗[/red] Microphone error: {e}")
            console.print("  [dim]Falling back to text input mode[/dim]")
            return False

    def listen(self, return_audio=False):
        """Listen for speech. If return_audio=True, returns (text, wav_bytes) tuple."""
        if not self._mic_available or self.suppressed:
            return (None, None) if return_audio else None

        if self._use_termux:
            with self._lock:
                try:
                    result = subprocess.run(
                        ["termux-speech-to-text"], capture_output=True, text=True, timeout=30
                    )
                    text = result.stdout.strip()
                    if not text or len(text) < 2:
                        return (None, None) if return_audio else None
                    if all(c in '[]{}().,;:!?"\'-_/\\|@#$%^&*~`' for c in text):
                        return (None, None) if return_audio else None
                    return (text, None) if return_audio else text
                except (subprocess.TimeoutExpired, Exception):
                    return (None, None) if return_audio else None

        with self._lock:
            try:
                devnull = os.open(os.devnull, os.O_WRONLY)
                old_stderr = os.dup(2)
                os.dup2(devnull, 2)
                try:
                    mic = sr.Microphone()
                    with mic as source:
                        audio = self.recognizer.listen(source, timeout=8, phrase_time_limit=30)
                finally:
                    os.dup2(old_stderr, 2)
                    os.close(devnull)
                    os.close(old_stderr)
                text = self.recognizer.recognize_google(audio)
                if return_audio:
                    return (text, audio.get_wav_data())
                return text
            except (sr.WaitTimeoutError, sr.UnknownValueError):
                return (None, None) if return_audio else None
            except sr.RequestError as e:
                console.print(f"  [red]Speech API error: {e}[/red]")
                return (None, None) if return_audio else None
            except OSError:
                return (None, None) if return_audio else None


# ── Command Execution ─────────────────────────────────────────────────────────

SAFE_PREFIXES = [
    "open ", "ls", "pwd", "date", "cal", "whoami", "uptime", "df ",
    "system_profiler", "sw_vers", "top -l 1", "ps aux", "echo ",
    "cat ", "head ", "tail ", "wc ", "du ", "which ", "python3 ",
    "brew ", "pmset", "networksetup", "ifconfig", "curl ",
    "osascript", "defaults read", "say ", "afplay ", "screencapture",
    "termux-open", "termux-battery-status", "termux-wifi-connectioninfo",
    "termux-toast", "termux-vibrate", "termux-tts-speak", "termux-notification",
    "termux-clipboard-set", "termux-clipboard-get", "termux-share",
    "xdg-open", "espeak", "mpv ", "ffplay ",
    "mdls ", "mdfind ", "diskutil list", "sysctl ", "mkdir ",
    "touch ", "cp ", "mv ", "chmod ", "find ", "grep ", "pip",
    "node ", "npm ", "git ", "zip ", "unzip ", "tar ",
]

BLOCKED_PATTERNS = ["rm -rf /", "sudo rm -rf", "mkfs", "> /dev", "dd if=", ":(){ :", "fork bomb"]


def is_safe_command(cmd: str) -> bool:
    cmd_stripped = cmd.strip()
    if any(danger in cmd_stripped for danger in BLOCKED_PATTERNS):
        return False
    return any(cmd_stripped.startswith(prefix) for prefix in SAFE_PREFIXES)


def execute_shell(cmd: str) -> str:
    if not is_safe_command(cmd):
        return f"⚠️ Blocked unsafe command: {cmd}"
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        output = result.stdout.strip()
        if result.returncode != 0 and result.stderr:
            output += f"\n(stderr: {result.stderr.strip()})"
        return output or "(command completed with no output)"
    except subprocess.TimeoutExpired:
        return "(command timed out after 30s)"
    except Exception as e:
        return f"(error: {e})"


def create_file(path: str, content: str) -> str:
    try:
        filepath = Path(path).expanduser()
        filepath.parent.mkdir(parents=True, exist_ok=True)
        filepath.write_text(content, encoding="utf-8")
        size = filepath.stat().st_size
        return f"✓ Created {filepath} ({size} bytes)"
    except Exception as e:
        return f"✗ Failed to create file: {e}"


def create_folder(path: str) -> str:
    """Create a folder (and all parent directories)."""
    try:
        folder = Path(path).expanduser()
        folder.mkdir(parents=True, exist_ok=True)
        return f"✓ Created folder {folder}"
    except Exception as e:
        return f"✗ Failed to create folder: {e}"


import shutil

def move_path(src: str, dst: str) -> str:
    """Move a file or folder."""
    try:
        src_p = Path(src).expanduser()
        dst_p = Path(dst).expanduser()
        if not src_p.exists():
            return f"✗ Source not found: {src_p}"
        dst_p.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src_p), str(dst_p))
        return f"✓ Moved {src_p} → {dst_p}"
    except Exception as e:
        return f"✗ Failed to move: {e}"


def copy_path(src: str, dst: str) -> str:
    """Copy a file or folder."""
    try:
        src_p = Path(src).expanduser()
        dst_p = Path(dst).expanduser()
        if not src_p.exists():
            return f"✗ Source not found: {src_p}"
        dst_p.parent.mkdir(parents=True, exist_ok=True)
        if src_p.is_dir():
            shutil.copytree(str(src_p), str(dst_p))
        else:
            shutil.copy2(str(src_p), str(dst_p))
        return f"✓ Copied {src_p} → {dst_p}"
    except Exception as e:
        return f"✗ Failed to copy: {e}"


def search_web(query: str) -> str:
    try:
        encoded_q = urllib.parse.quote(query)
        # Don't open Safari — just return text results. Use computer_use for browsing.

        ddg_url = f"https://html.duckduckgo.com/html/?q={encoded_q}"
        req = urllib.request.Request(ddg_url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="replace")

        results = []
        links = re.findall(r'<a[^>]*class="result__a"[^>]*>(.*?)</a>', html, re.DOTALL)
        snippets = re.findall(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', html, re.DOTALL)

        for i, (link, snippet) in enumerate(zip(links[:8], snippets[:8]), 1):
            clean_link = re.sub(r'<[^>]+>', '', link).strip()
            clean_snip = re.sub(r'<[^>]+>', '', snippet).strip()
            clean_snip = clean_snip.replace("&#x27;", "'").replace("&amp;", "&").replace("&quot;", '"')
            clean_link = clean_link.replace("&#x27;", "'").replace("&amp;", "&").replace("&quot;", '"')
            if clean_snip:
                results.append(f"{i}. {clean_link}\n   {clean_snip}")

        if results:
            return f"Search results for '{query}':\n\n" + "\n\n".join(results)

        text = re.sub(r'<[^>]+>', ' ', html)
        text = re.sub(r'\s+', ' ', text).strip()
        return f"Search results for '{query}':\n{text[:2000]}"
    except Exception as e:
        return f"Search error: {e}"


def fetch_url(url: str) -> str:
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            content_type = resp.headers.get("Content-Type", "")
            raw = resp.read()

            if "json" in content_type:
                data = json.loads(raw.decode("utf-8", errors="replace"))
                return json.dumps(data, indent=2)[:4000]

            text = raw.decode("utf-8", errors="replace")
            if "html" in content_type:
                text = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', text, flags=re.DOTALL | re.IGNORECASE)
                text = re.sub(r'<[^>]+>', ' ', text)
                text = re.sub(r'\s+', ' ', text).strip()

            return text[:4000] if text else "(empty response)"
    except Exception as e:
        return f"Fetch error: {e}"


def analyze_screen(prompt: str = "Describe what's on my screen in detail.") -> str:
    """Take a screenshot and analyze it with Gemini vision."""
    try:
        import base64
        import subprocess
        tmp = "/tmp/darvis_screen.png"
        subprocess.run(["screencapture", "-x", tmp], timeout=5, check=True)
        with open(tmp, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()

        env = load_env()
        gkey = env.get("GEMINI_API_KEY", os.environ.get("GEMINI_API_KEY", ""))
        if not gkey:
            return "No Gemini API key — can't analyze screen"

        payload = json.dumps({
            "contents": [{"parts": [
                {"inlineData": {"mimeType": "image/png", "data": img_b64}},
                {"text": prompt}
            ]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1024}
        }).encode()

        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gkey}"
        req = urllib.request.Request(url, data=payload, method="POST",
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        return f"Screen analysis error: {e}"


def open_file(path: str) -> str:
    """Open a file or URL using the system default handler."""
    try:
        target = Path(path).expanduser() if not path.startswith("http") else path
        if not path.startswith("http") and not Path(target).exists():
            return f"✗ File not found: {target}"
        _open_path(str(target))
        return f"✓ Opened {target}"
    except Exception as e:
        return f"✗ Failed to open: {e}"


# ── Safari Browser Control ────────────────────────────────────────────────────

def _run_applescript(script: str) -> str:
    """Run an AppleScript and return its output."""
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=15,
        )
        output = result.stdout.strip()
        if result.returncode != 0 and result.stderr:
            return f"(AppleScript error: {result.stderr.strip()})"
        return output
    except subprocess.TimeoutExpired:
        return "(timed out)"
    except Exception as e:
        return f"(error: {e})"


def _safari_js(js_code: str) -> str:
    """Execute JavaScript in the current Safari tab and return the result."""
    escaped = js_code.replace("\\", "\\\\").replace('"', '\\"')
    script = f'tell application "Safari" to do JavaScript "{escaped}" in current tab of front window'
    result = _run_applescript(script)
    if "Allow JavaScript from Apple Events" in result:
        return ("✗ Safari needs JavaScript enabled for DARVIS control.\n"
                "Enable it: Safari → Settings → Advanced → tick 'Show features for web developers'\n"
                "Then: Developer menu → tick 'Allow JavaScript from Apple Events'")
    return result


# Shared JS to extract meaningful links (filters out Google/nav junk)
SAFARI_GET_LINKS_JS = """
(function() {
    var skip = ['google.com/search','google.com/preferences','accounts.google','maps.google','support.google','policies.google','google.com/intl'];
    var links = document.querySelectorAll('a[href]');
    var seen = {};
    var results = [];
    var idx = 0;
    for (var i = 0; i < links.length && idx < 25; i++) {
        var text = links[i].innerText.trim().substring(0, 80);
        var href = links[i].href;
        var dominated = false;
        for (var s = 0; s < skip.length; s++) { if (href.includes(skip[s])) { dominated = true; break; } }
        if (text && text.length > 2 && href && !href.startsWith('javascript:') && !dominated && !seen[href]) {
            seen[href] = true;
            results.push(idx + '|' + text + '|' + href);
            idx++;
        }
    }
    return results.join('\\n');
})()
"""


def _safari_navigate(url: str):
    """Navigate Safari to a URL directly via AppleScript (most reliable)."""
    escaped_url = url.replace('"', '\\"')
    _run_applescript(f'tell application "Safari" to set URL of current tab of front window to "{escaped_url}"')
    _run_applescript('tell application "Safari" to activate')


def safari_control(data: dict) -> str:
    """Handle Safari browser control actions."""
    if not IS_MAC:
        return "Safari control is only available on macOS. Use search_web or fetch_url instead."
    method = data.get("method", "")

    if method == "get_page_info":
        url = _run_applescript('tell application "Safari" to get URL of current tab of front window')
        title = _run_applescript('tell application "Safari" to get name of current tab of front window')

        links_js = SAFARI_GET_LINKS_JS
        raw_links = _safari_js(links_js)

        # Format for display
        formatted = []
        for line in raw_links.split("\n"):
            parts = line.split("|", 2)
            if len(parts) == 3:
                formatted.append(f"  [{parts[0]}] {parts[1]}\n      {parts[2]}")

        links_display = "\n".join(formatted) if formatted else "(no links found)"
        return f"Safari Page Info:\nTitle: {title}\nURL: {url}\n\nClickable Links:\n{links_display}"

    elif method == "click_link":
        # Strategy: get the href from the page, then navigate via AppleScript (much more reliable than .click())
        if "index" in data:
            idx = int(data["index"])
            js = f"""
            (function() {{
                var skip = ['google.com/search','google.com/preferences','accounts.google','maps.google','support.google','policies.google','google.com/intl'];
                var links = document.querySelectorAll('a[href]');
                var seen = {{}};
                var clickable = [];
                for (var i = 0; i < links.length; i++) {{
                    var text = links[i].innerText.trim();
                    var href = links[i].href;
                    var dominated = false;
                    for (var s = 0; s < skip.length; s++) {{ if (href.includes(skip[s])) {{ dominated = true; break; }} }}
                    if (text && text.length > 2 && href && !href.startsWith('javascript:') && !dominated && !seen[href]) {{
                        seen[href] = true;
                        clickable.push({{text: text.substring(0, 80), href: href}});
                    }}
                }}
                if ({idx} < clickable.length) {{
                    return clickable[{idx}].href + '|||' + clickable[{idx}].text;
                }}
                return 'NOT_FOUND|||' + clickable.length + ' links available';
            }})()
            """
            result = _safari_js(js)
            parts = result.split("|||", 1)
            if parts[0] == "NOT_FOUND":
                return f"Link index {idx} not found ({parts[1] if len(parts) > 1 else ''})"
            href = parts[0]
            text = parts[1] if len(parts) > 1 else ""
            _safari_navigate(href)
            import time
            time.sleep(0.5)
            new_title = _run_applescript('tell application "Safari" to get name of current tab of front window')
            return f"✓ Clicked [{idx}] \"{text}\"\n  Navigated to: {href}\n  Page loaded: {new_title}"

        elif "text" in data:
            search_text = data["text"].replace("'", "\\'").replace('"', '\\"')
            js = f"""
            (function() {{
                var skip = ['google.com/search','google.com/preferences','accounts.google','maps.google','support.google','policies.google','google.com/intl'];
                var links = document.querySelectorAll('a[href]');
                for (var i = 0; i < links.length; i++) {{
                    var text = links[i].innerText.trim();
                    var href = links[i].href;
                    var dominated = false;
                    for (var s = 0; s < skip.length; s++) {{ if (href.includes(skip[s])) {{ dominated = true; break; }} }}
                    if (text && href && !href.startsWith('javascript:') && !dominated && text.toLowerCase().includes('{search_text.lower()}')) {{
                        return href + '|||' + text.substring(0, 80);
                    }}
                }}
                return 'NOT_FOUND|||No link matching "{search_text}"';
            }})()
            """
            result = _safari_js(js)
            parts = result.split("|||", 1)
            if parts[0] == "NOT_FOUND":
                return parts[1] if len(parts) > 1 else "Link not found"
            href = parts[0]
            text = parts[1] if len(parts) > 1 else ""
            _safari_navigate(href)
            import time
            time.sleep(0.5)
            new_title = _run_applescript('tell application "Safari" to get name of current tab of front window')
            return f"✓ Clicked \"{text}\"\n  Navigated to: {href}\n  Page loaded: {new_title}"

        return "Need 'index' or 'text' to click a link"

    elif method == "click_button":
        search_text = data.get("text", "").replace("'", "\\'").replace('"', '\\"')
        js = f"""
        (function() {{
            var els = document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a.btn, a.button');
            for (var i = 0; i < els.length; i++) {{
                var btnText = (els[i].innerText || els[i].value || els[i].getAttribute('aria-label') || '').trim();
                if (btnText.toLowerCase().includes('{search_text.lower()}')) {{
                    els[i].dispatchEvent(new MouseEvent('click', {{bubbles: true, cancelable: true}}));
                    return 'Clicked button: ' + btnText.substring(0, 60);
                }}
            }}
            return 'No button found matching "{search_text}"';
        }})()
        """
        return _safari_js(js)

    elif method == "read_page":
        js = """
        (function() {
            var body = document.body.innerText;
            return body.substring(0, 4000);
        })()
        """
        text = _safari_js(js)
        return f"Page Content:\n{text}" if text else "Could not read page"

    elif method == "run_js":
        code = data.get("code", "")
        if not code:
            return "No JavaScript code provided"
        return _safari_js(code)

    elif method == "navigate":
        url = data.get("url", "")
        if not url:
            return "No URL provided"
        _safari_navigate(url)
        return f"✓ Navigated to {url}"

    elif method == "back":
        _safari_js("history.back()")
        return "✓ Went back"

    elif method == "forward":
        _safari_js("history.forward()")
        return "✓ Went forward"

    elif method == "scroll":
        direction = data.get("direction", "down")
        if direction == "down":
            _safari_js("window.scrollBy(0, 600)")
        elif direction == "up":
            _safari_js("window.scrollBy(0, -600)")
        elif direction == "top":
            _safari_js("window.scrollTo(0, 0)")
        elif direction == "bottom":
            _safari_js("window.scrollTo(0, document.body.scrollHeight)")
        return f"✓ Scrolled {direction}"

    elif method == "type_text":
        text = data.get("text", "").replace("'", "\\'")
        js = f"""
        (function() {{
            var el = document.activeElement;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {{
                el.value = '{text}';
                el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                return 'Typed into ' + el.tagName + ': ' + '{text}'.substring(0, 40);
            }}
            // Try to find a visible search/text input
            var inputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), textarea');
            for (var i = 0; i < inputs.length; i++) {{
                if (inputs[i].offsetParent !== null) {{
                    inputs[i].focus();
                    inputs[i].value = '{text}';
                    inputs[i].dispatchEvent(new Event('input', {{ bubbles: true }}));
                    return 'Typed into ' + inputs[i].tagName + ': ' + '{text}'.substring(0, 40);
                }}
            }}
            return 'No input field found on page';
        }})()
        """
        return _safari_js(js)

    else:
        return f"Unknown Safari method: {method}"


def extract_and_run_commands(response_text: str) -> list[str]:
    results = []
    pattern = r'```command\s*\n(.*?)\n```'
    matches = re.findall(pattern, response_text, re.DOTALL)
    for match in matches:
        try:
            data = json.loads(match)
            action = data.get("action", "")

            if action == "shell" and "command" in data:
                cmd = data["command"]
                console.print(f"  [dim]Shell:[/dim] {cmd}")
                output = execute_shell(cmd)
                results.append(output)
                if output:
                    console.print(f"  [dim]{output[:300]}[/dim]")

            elif action == "create_file" and "path" in data and "content" in data:
                console.print(f"  [dim]Creating:[/dim] {data['path']}")
                output = create_file(data["path"], data["content"])
                results.append(output)
                console.print(f"  [dim]{output}[/dim]")

            elif action == "search_web" and "query" in data:
                console.print(f"  [dim]Searching:[/dim] {data['query']}")
                output = search_web(data["query"])
                results.append(output)
                console.print(f"  [dim]{output[:300]}...[/dim]")

            elif action == "fetch_url" and "url" in data:
                console.print(f"  [dim]Fetching:[/dim] {data['url']}")
                output = fetch_url(data["url"])
                results.append(output)
                console.print(f"  [dim]{output[:300]}...[/dim]")

            elif action == "open_file" and "path" in data:
                target = data["path"]
                console.print(f"  [dim]Opening:[/dim] {target}")
                output = open_file(target)
                results.append(output)
                console.print(f"  [dim]{output}[/dim]")

            elif action == "create_folder" and "path" in data:
                console.print(f"  [dim]Creating folder:[/dim] {data['path']}")
                output = create_folder(data["path"])
                results.append(output)
                console.print(f"  [dim]{output}[/dim]")

            elif action == "move" and "from" in data and "to" in data:
                console.print(f"  [dim]Moving:[/dim] {data['from']} → {data['to']}")
                output = move_path(data["from"], data["to"])
                results.append(output)
                console.print(f"  [dim]{output}[/dim]")

            elif action == "copy" and "from" in data and "to" in data:
                console.print(f"  [dim]Copying:[/dim] {data['from']} → {data['to']}")
                output = copy_path(data["from"], data["to"])
                results.append(output)
                console.print(f"  [dim]{output}[/dim]")

            elif action == "safari" and "method" in data:
                method = data["method"]
                console.print(f"  [dim]Safari:[/dim] {method}")
                output = safari_control(data)
                results.append(output)
                if output:
                    console.print(f"  [dim]{output[:400]}[/dim]")

            elif action == "computer_use" and "goal" in data:
                goal = data["goal"]
                console.print(f"  [dim]Computer Use:[/dim] {goal}")
                try:
                    env = load_env()
                    gkey = env.get("GEMINI_API_KEY", os.environ.get("GEMINI_API_KEY", ""))
                    if gkey:
                        from computer_use import run_agent
                        console.print(f"  [{BLUE}]Launching browser agent...[/{BLUE}]")
                        summary = run_agent(gkey, goal)
                        results.append(f"Browser agent completed: {summary}")
                        console.print(f"  [green]✓[/green] {summary}")
                    else:
                        results.append("Computer Use unavailable — no GEMINI_API_KEY set")
                except Exception as e:
                    results.append(f"Computer Use error: {e}")
                    console.print(f"  [red]Agent error: {e}[/red]")

            elif action == "remember" and "content" in data:
                from memory import add_memory
                cat = data.get("category", "general")
                console.print(f"  [dim]Remembering:[/dim] {data['content']}")
                output = add_memory(data["content"], cat)
                results.append(output)
                console.print(f"  [dim]{output}[/dim]")

            elif action == "forget" and "id" in data:
                from memory import forget_memory
                console.print(f"  [dim]Forgetting memory #{data['id']}[/dim]")
                output = forget_memory(int(data["id"]))
                results.append(output)
                console.print(f"  [dim]{output}[/dim]")

            elif action == "schedule" and "task" in data:
                from scheduler import _global_scheduler
                if _global_scheduler:
                    task = _global_scheduler.add_task(
                        task_desc=data["task"],
                        delay_minutes=data.get("delay_minutes"),
                        at_time=data.get("at"),
                        recurring_minutes=data.get("recurring_minutes"),
                    )
                    time_str = task.execute_at.strftime("%I:%M %p")
                    output = f"✓ Scheduled: '{data['task']}' at {time_str}"
                    if task.recurring:
                        output += f" (repeating every {task.recurring} min)"
                    results.append(output)
                    console.print(f"  [green]{output}[/green]")
                else:
                    results.append("Scheduler not initialized")

            elif action == "analyze_screen":
                result = analyze_screen(data.get("prompt", "Describe what's on the screen."))
                results.append(result)
                console.print(f"  [green]✓ Screen analyzed[/green]")

            elif action == "alert_add" and "type" in data:
                try:
                    from alerts import AlertMonitor
                    # Try to use the running monitor
                    import __main__
                    monitor = getattr(__main__, 'alert_monitor', None)
                    if monitor is None:
                        monitor = AlertMonitor()
                    msg = monitor.add(data["type"], data.get("config", {}))
                    results.append(msg)
                    console.print(f"  [green]{msg}[/green]")
                except Exception as e:
                    results.append(f"Alert error: {e}")

            elif action == "macro_add" and "name" in data:
                try:
                    from macros import MacroManager
                    import __main__
                    mgr = getattr(__main__, 'macro_manager', None)
                    if mgr is None:
                        mgr = MacroManager()
                    msg = mgr.add(data["name"], data.get("command", ""))
                    results.append(msg)
                    console.print(f"  [green]{msg}[/green]")
                except Exception as e:
                    results.append(f"Macro error: {e}")

            elif action == "macro_remove" and "name" in data:
                try:
                    from macros import MacroManager
                    import __main__
                    mgr = getattr(__main__, 'macro_manager', None)
                    if mgr is None:
                        mgr = MacroManager()
                    msg = mgr.remove(data["name"])
                    results.append(msg)
                except Exception as e:
                    results.append(f"Macro error: {e}")

        except json.JSONDecodeError:
            pass
    return results


# ── Brain (Ollama Cloud) ──────────────────────────────────────────────────────

def load_env() -> dict[str, str]:
    env = {}
    if CONFIG_PATH.exists():
        for line in CONFIG_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def get_key(name: str, prompt_msg: str = "") -> str:
    env = load_env()
    if name in env and env[name]:
        return env[name]
    val = os.environ.get(name)
    if val:
        return val
    if prompt_msg:
        console.print(Panel(prompt_msg, title="[bold yellow]Key Required[/bold yellow]", border_style="yellow"))
        val = console.input("  [bold]Paste key: [/bold]").strip()
        if val:
            with open(CONFIG_PATH, "a") as f:
                f.write(f"{name}={val}\n")
            return val
    return ""


class Brain:
    def __init__(self, api_key: str, model: str = MODEL):
        self.api_key = api_key
        self.model = model
        self.history: list[dict] = []
        # Load conversation history from cloud on startup
        try:
            from history import load_history
            self.history = load_history()
        except Exception:
            pass

    def _call_ollama(self, messages: list[dict]) -> str:
        payload = json.dumps({
            "model": self.model,
            "messages": messages,
            "stream": False,
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{OLLAMA_URL}/chat",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["message"]["content"]

    def think(self, user_input: str, context: str = "") -> str:
        now = datetime.datetime.now()
        tz = now.astimezone().strftime("%Z")
        hour = now.hour
        period = "LATE NIGHT" if hour < 6 else "MORNING" if hour < 12 else "AFTERNOON" if hour < 17 else "EVENING" if hour < 21 else "NIGHT"
        time_ctx = f"""CURRENT DATE/TIME (accurate, trust this):
  Date: {now.strftime('%A, %B %d, %Y')}
  Time: {now.strftime('%I:%M %p')} {tz}
  Period: {period}"""

        content = f"{time_ctx}\n{user_input}"
        if context:
            content += f"\n\n[System output from previous command:\n{context}]"

        user_msg = {"role": "user", "content": content}
        self.history.append(user_msg)

        if len(self.history) > MAX_HISTORY * 2:
            self.history = self.history[-(MAX_HISTORY * 2):]

        from memory import get_memory_context
        prompt = SYSTEM_PROMPT.replace("HOME_DIR", HOME_DIR)
        prompt += f"\n\nYou are currently running the {self.model} model on the terminal (macOS). When asked what model you use, say {self.model}. You run across iPhone, browser, terminal, and Android — all share memory and history."
        prompt += get_memory_context()
        messages = [{"role": "system", "content": prompt}] + self.history

        reply = self._call_ollama(messages)
        assistant_msg = {"role": "assistant", "content": reply}
        self.history.append(assistant_msg)

        # Sync to cloud in background
        def _sync():
            try:
                from history import save_history
                save_history(self.history)
            except Exception:
                pass
        threading.Thread(target=_sync, daemon=True).start()

        return reply


# ── Ollama Cloud Helpers ──────────────────────────────────────────────────────

def fix_yourself(brain, tts, ear, ollama_key, elevenlabs_key, gemini_key, audio_mode):
    """Run self-diagnostics and fix what we can."""
    results = []
    fixed = []

    console.print(Panel("[bold]Running diagnostics...[/bold]", title=f"[bold {ORANGE}]🔧 Fix Yourself[/bold {ORANGE}]", border_style=ORANGE))

    # 1. Ollama Cloud
    with console.status(f"[{BLUE}]Checking Ollama Cloud...", spinner="arc"):
        if check_ollama_cloud(ollama_key):
            models = list_cloud_models(ollama_key)
            if brain.model in models:
                results.append(f"[green]✓[/green] Ollama Cloud: OK (model: {brain.model})")
            elif models:
                results.append(f"[yellow]⚠[/yellow] Ollama Cloud: online, but model '{brain.model}' not found")
                results.append(f"  [dim]Available: {', '.join(models[:5])}[/dim]")
            else:
                results.append(f"[green]✓[/green] Ollama Cloud: OK")
        else:
            results.append(f"[red]✗[/red] Ollama Cloud: unreachable")

    # 2. ElevenLabs
    with console.status(f"[{BLUE}]Checking ElevenLabs...", spinner="arc"):
        voices = tts.fetch_voices()
        if voices:
            voice_ids = [v.get("voice_id", "") for v in voices]
            if tts.voice_id in voice_ids:
                results.append(f"[green]✓[/green] ElevenLabs: OK (voice: {tts.voice_name})")
            else:
                results.append(f"[yellow]⚠[/yellow] ElevenLabs: online, but voice ID not found")
        else:
            results.append(f"[red]✗[/red] ElevenLabs: unreachable or no voices")

    # 3. Gemini
    if gemini_key:
        results.append(f"[green]✓[/green] Gemini API key: present")
    else:
        results.append(f"[dim]—[/dim] Gemini API key: not configured")

    # 4. Mic
    if ear._mic_available:
        results.append(f"[green]✓[/green] Microphone: available")
    else:
        with console.status(f"[{BLUE}]Reinitializing mic...", spinner="arc"):
            if ear.init_mic():
                results.append(f"[green]✓[/green] Microphone: reinitialized")
                fixed.append("reinitialized microphone")
            else:
                results.append(f"[red]✗[/red] Microphone: not available")

    # 5. Reset stuck states
    if ear.suppressed:
        ear.suppressed = False
        fixed.append("unblocked mic (was suppressed)")
    # Drain speech queue
    try:
        while not ear._speech_queue_ref.empty():
            ear._speech_queue_ref.get_nowait()
    except (AttributeError, Exception):
        pass

    # 6. Audio mode
    results.append(f"[dim]—[/dim] Audio mode: {audio_mode}")

    # Summary
    fixed_str = ", ".join(fixed) if fixed else "No issues found"
    console.print(
        Panel(
            "\n".join(results) + f"\n\n[bold]Fixed:[/bold] {fixed_str}",
            title=f"[bold {CYAN}]Diagnostics Complete[/bold {CYAN}]",
            border_style=CYAN,
        )
    )

    # Speak summary
    ok_count = sum(1 for r in results if "✓" in r)
    warn_count = sum(1 for r in results if "⚠" in r)
    fail_count = sum(1 for r in results if "✗" in r)
    if fail_count:
        tts.speak(f"Diagnostics complete. {fail_count} issue{'s' if fail_count > 1 else ''} found. {', '.join(fixed) if fixed else 'Manual attention needed'}.")
    elif warn_count:
        tts.speak(f"Diagnostics complete. {warn_count} warning{'s' if warn_count > 1 else ''}, but everything is operational.")
    else:
        tts.speak("All systems nominal, sir. Everything checks out.")


def check_ollama_cloud(api_key: str) -> bool:
    try:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/tags",
            headers={"Authorization": f"Bearer {api_key}"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=10):
            return True
    except (urllib.error.URLError, ConnectionError, OSError):
        return False


def list_cloud_models(api_key: str) -> list[str]:
    try:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/tags",
            headers={"Authorization": f"Bearer {api_key}"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []


def select_model(api_key: str, saved_model: str = "") -> str:
    """Interactive model picker with live Ollama Cloud models."""
    if saved_model:
        console.print(f"  [dim]Current model:[/dim] [bold {CYAN}]{saved_model}[/bold {CYAN}]")
        choice = console.input(f"  [bold]Keep? [enter=yes, n=change]: [/bold]").strip().lower()
        if choice not in ("n", "no", "change"):
            return saved_model

    # Fetch live models
    models = list_cloud_models(api_key)
    if not models:
        models = ["glm-5", "gemma4:31b", "deepseek-v3.2", "qwen3.5:397b", "mistral-large-3:675b"]

    console.print()
    console.print(
        Panel(
            _format_model_list(models, saved_model),
            title=f"[bold {CYAN}]Available Models ({len(models)})[/bold {CYAN}]",
            border_style=BLUE,
            padding=(1, 2),
        )
    )

    choice = console.input(f"\n  [bold]Select # or name [enter={saved_model or 'glm-5'}]: [/bold]").strip()

    if not choice:
        return saved_model or "glm-5"
    if choice.isdigit() and 1 <= int(choice) <= len(models):
        return models[int(choice) - 1]
    return choice


def _format_model_list(models: list, current: str = "") -> str:
    """Format models in columns with categories."""
    lines = []
    for i, name in enumerate(models, 1):
        marker = " [green]◀ current[/green]" if name == current else ""
        # Color-code by family
        if "gemma" in name: color = "bright_green"
        elif "deepseek" in name: color = "bright_cyan"
        elif "qwen" in name: color = "bright_magenta"
        elif "glm" in name: color = "bright_yellow"
        elif "mistral" in name or "ministral" in name: color = "bright_red"
        elif "kimi" in name: color = "bright_blue"
        elif "gemini" in name: color = "bright_green"
        else: color = "white"
        lines.append(f"  [{color}]{i:2d}. {name}[/{color}]{marker}")
    return "\n".join(lines)


# ── Voice Selection ───────────────────────────────────────────────────────────

def show_voice_menu(tts: ElevenLabsVoice) -> str:
    table = Table(title="Available Voices", border_style=BLUE)
    table.add_column("#", style="dim", width=3)
    table.add_column("Name", style=f"bold {CYAN}")
    table.add_column("Description", style=DIM)
    table.add_column("ID", style="dim")

    voices = list(ElevenLabsVoice.PRESET_VOICES.items())

    console.print(f"  [dim]Fetching voices...[/dim]")
    account_voices = tts.fetch_voices()
    custom_voices = []
    preset_ids = {v["id"] for v in ElevenLabsVoice.PRESET_VOICES.values()}
    for v in account_voices:
        if v["voice_id"] not in preset_ids:
            custom_voices.append((v["name"].lower(), {"id": v["voice_id"], "desc": v.get("labels", {}).get("description", v.get("category", "custom"))}))

    all_voices = voices + custom_voices

    for i, (name, info) in enumerate(all_voices, 1):
        current = " ◄" if info["id"] == tts.voice_id else ""
        table.add_row(str(i), name.title(), info["desc"], info["id"][:16] + "..." + current)

    console.print()
    console.print(table)
    console.print(f"\n  [dim]Or paste any ElevenLabs voice ID directly.[/dim]")

    choice = console.input(f"\n  [bold]Select voice [enter to keep current]: [/bold]").strip()

    if not choice:
        return tts.voice_id
    if choice.isdigit() and 1 <= int(choice) <= len(all_voices):
        return all_voices[int(choice) - 1][1]["id"]
    for name, info in all_voices:
        if choice.lower() == name:
            return info["id"]
    return choice


def select_initial_voice(tts: ElevenLabsVoice, saved_voice: str = "") -> str:
    if saved_voice:
        tts.set_voice(saved_voice)
        console.print(f"  [dim]Saved voice:[/dim] [bold]{tts.voice_name.title()}[/bold]")
        choice = console.input(f"  [bold]Keep {tts.voice_name.title()}? [enter=yes, n=change]: [/bold]").strip().lower()
        if choice not in ("n", "no", "change"):
            return saved_voice

    account_voices = tts.fetch_voices()
    default_name = "Custom"
    for v in account_voices:
        if v["voice_id"] == DEFAULT_VOICE_ID:
            default_name = v["name"]
            break

    console.print(f"\n  [dim]ElevenLabs voices:[/dim]")
    console.print(f"    [green]★  {default_name} (default)[/green] — {DEFAULT_VOICE_ID[:16]}...")
    voices = list(ElevenLabsVoice.PRESET_VOICES.items())
    for i, (name, info) in enumerate(voices, 1):
        console.print(f"    {i}. {name.title():10s} — {info['desc']}")

    console.print(f"    [dim]Or paste a voice ID directly[/dim]")
    choice = console.input(f"\n  [bold]Select voice [enter for {default_name}]: [/bold]").strip()

    if not choice:
        return DEFAULT_VOICE_ID
    if choice.isdigit() and 1 <= int(choice) <= len(voices):
        return voices[int(choice) - 1][1]["id"]
    for name, info in voices:
        if choice.lower() == name:
            return info["id"]
    return choice


# ── Main Loop ─────────────────────────────────────────────────────────────────

def main():
    banner()

    # Load saved settings
    settings = load_settings()
    saved_model = settings.get("model", "")
    saved_voice = settings.get("voice_id", "")
    if saved_model or saved_voice:
        console.print(f"  [dim]Loaded saved settings[/dim]")

    # Load keys
    ollama_key = get_key("OLLAMA_API_KEY", "I need an Ollama Cloud API key.\nGet one at: https://ollama.com/settings/keys")
    if not ollama_key:
        console.print("  [red]No Ollama key. Exiting.[/red]")
        sys.exit(1)
    console.print(f"  [green]✓[/green] Ollama API key loaded")

    elevenlabs_key = get_key("ELEVENLABS_API_KEY", "I need an ElevenLabs API key for voice.\nGet one at: https://elevenlabs.io/app/settings/api-keys")
    if not elevenlabs_key:
        console.print("  [red]No ElevenLabs key. Exiting.[/red]")
        sys.exit(1)
    console.print(f"  [green]✓[/green] ElevenLabs API key loaded")

    # Gemini key (optional — enables Gemini Live Audio mode)
    gemini_key = load_env().get("GEMINI_API_KEY", os.environ.get("GEMINI_API_KEY", ""))
    gemini_available = False
    if gemini_key:
        try:
            from gemini_live import HAS_WS
            if HAS_WS:
                gemini_available = True
                console.print(f"  [green]✓[/green] Gemini Live Audio available (/gemini to enable)")
            else:
                console.print(f"  [dim]Gemini: install websockets package for live audio[/dim]")
        except ImportError:
            console.print(f"  [dim]Gemini: gemini_live.py not found[/dim]")
    audio_mode = "classic"  # Start in classic mode

    # Check Ollama Cloud
    with console.status(f"[{BLUE}]Connecting to Ollama Cloud...", spinner="arc"):
        cloud_ok = check_ollama_cloud(ollama_key)

    if not cloud_ok:
        console.print(
            Panel(
                "Cannot reach Ollama Cloud.\n"
                "Check your API key and internet connection.\n"
                f"Endpoint: {OLLAMA_URL}",
                title="[bold red]Connection Failed[/bold red]",
                border_style="red",
            )
        )
        console.print(f"  [yellow]Continuing anyway...[/yellow]\n")
    else:
        console.print(f"  [green]✓[/green] Ollama Cloud connected")

    # Select model (uses saved if available)
    model = select_model(ollama_key, saved_model)
    brain = Brain(api_key=ollama_key, model=model)
    console.print(f"  [green]✓[/green] Brain online ({model})")

    # Select voice (uses saved if available)
    tts = ElevenLabsVoice(api_key=elevenlabs_key)
    voice_id = select_initial_voice(tts, saved_voice)
    tts.set_voice(voice_id)
    console.print(f"  [green]✓[/green] Voice: {tts.voice_name.title()}")

    # Save settings for next run
    save_settings({"model": model, "voice_id": voice_id})

    # Start web dashboard in background
    try:
        from web import DarvisHandler, ReusableHTTPServer
        from http.server import HTTPServer
        WEB_PORT = 2414
        def _run_web():
            try:
                # Import and update web module's globals to share state
                import web as _web
                _web.OLLAMA_KEY = ollama_key
                _web.ELEVENLABS_KEY = elevenlabs_key
                _web.MODEL = model
                _web.VOICE_ID = voice_id
                srv = _web.ReusableHTTPServer(('0.0.0.0', WEB_PORT), _web.DarvisHandler)
                srv.serve_forever()
            except Exception:
                pass
        web_thread = threading.Thread(target=_run_web, daemon=True)
        web_thread.start()
        console.print(f"  [green]✓[/green] Web dashboard: http://127.0.0.1:{WEB_PORT}")
    except Exception:
        console.print(f"  [dim]Web dashboard not available[/dim]")

    # Init microphone
    ear = Ear()
    has_mic = ear.init_mic()

    # Start in /type mode (text-only, no auto-listening)
    listening_active = False
    gemini_line = "[bold]/gemini[/bold]     — Gemini Live Audio (speech-to-speech + mic on)\n" if gemini_available else ""
    console.print(
        Panel(
            f"Input: [bold]text[/bold] | Voice: [bold]{tts.voice_name.title()}[/bold] | Model: [bold]{model}[/bold]\n"
            + "Type your message, or use commands below:\n"
            + "[bold]/listen[/bold]     — start listening via microphone\n"
            + "[bold]/type[/bold]       — stop listening, text-only mode\n"
            + gemini_line
            + "[bold]/voices[/bold]     — change voice\n"
            + "[bold]/voice NAME[/bold] — quick switch voice\n"
            + "[bold]/help[/bold]       — all commands\n"
            + "[bold]goodbye[/bold]     — exit D.A.R.V.I.S.",
            title=f"[bold {CYAN}]D.A.R.V.I.S. Ready[/bold {CYAN}]",
            border_style=CYAN,
        )
    )

    # ── Schedule automatic briefings at 8 AM and 9:30 PM ──
    def _schedule_daily_briefings():
        """Set up recurring briefings. Only adds them if not already scheduled."""
        import time as _time
        _time.sleep(3)  # Wait for scheduler to initialize

        from scheduler import _global_scheduler
        if not _global_scheduler:
            return

        existing = _global_scheduler.list_tasks()
        has_morning = any("morning briefing" in t.get("task", "").lower() for t in existing)
        has_night = any("evening briefing" in t.get("task", "").lower() for t in existing)

        now = datetime.datetime.now()
        today = now.date()

        if not has_morning:
            morning = datetime.datetime.combine(today, datetime.time(8, 0))
            if morning < now:
                morning += datetime.timedelta(days=1)
            _global_scheduler.add_task(
                task_desc="""MORNING BRIEFING — Do ALL of these steps with command blocks:
1. Use fetch_url to get weather: fetch_url https://wttr.in/?format=%C+%t+%h+%w
2. Use search_web to find today's top news
3. Create a file on the Desktop called DARVIS_Morning_Briefing.txt with the date, weather, and top 5 news stories with summaries
4. Open that file with open_file
5. Navigate Safari to https://news.google.com using safari navigate
6. After all commands execute, give a spoken briefing: greeting, weather, 2-3 news stories summarized, reminders, and say you've opened the news and saved the briefing.""",
                at_time=morning.isoformat(),
                recurring_minutes=1440,
            )
            console.print(f"  [green]✓[/green] Morning briefing scheduled for 8:00 AM daily")

        if not has_night:
            night = datetime.datetime.combine(today, datetime.time(21, 30))
            if night < now:
                night += datetime.timedelta(days=1)
            _global_scheduler.add_task(
                task_desc="""EVENING BRIEFING — Do ALL of these steps with command blocks:
1. Use fetch_url to get weather: fetch_url https://wttr.in/?format=%C+%t+%h+%w
2. Use search_web to find tonight's top news
3. Create a file on the Desktop called DARVIS_Evening_Briefing.txt with the date, weather, and top 5 news stories with summaries
4. Open that file with open_file
5. Navigate Safari to https://news.google.com using safari navigate
6. After all commands execute, give a spoken evening wrap-up: what happened today in the news, tomorrow's weather, reminders, wish good night.""",
                at_time=night.isoformat(),
                recurring_minutes=1440,
            )
            console.print(f"  [green]✓[/green] Evening briefing scheduled for 9:30 PM daily")

    briefing_sched_thread = threading.Thread(target=_schedule_daily_briefings, daemon=True)
    briefing_sched_thread.start()

    # Background agent goal polling — picks up browse tasks from the browser app
    def _poll_agent_goals():
        """Check for pending Computer Use goals from the browser."""
        import time as _time
        while True:
            _time.sleep(5)
            try:
                req = urllib.request.Request(
                    "https://darvis1.netlify.app/api/agent/goal",
                    method="GET",
                )
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode())
                    if data.get("goal"):
                        goal = data["goal"]
                        console.print(f"\n  [{BLUE}]Browser requested agent task: {goal}[/{BLUE}]")
                        gkey = load_env().get("GEMINI_API_KEY", os.environ.get("GEMINI_API_KEY", ""))
                        if gkey:
                            try:
                                from computer_use import run_agent
                                summary = run_agent(gkey, goal)
                                console.print(
                                    Panel(summary, title=f"[bold {CYAN}]Agent Complete[/bold {CYAN}]", border_style=BLUE)
                                )
                                tts.speak(summary)
                                tts.wait_for_speech()
                            except Exception as e:
                                console.print(f"  [red]Agent error: {e}[/red]")
            except Exception:
                pass

            # Check for pending commands from browser/iOS
            try:
                cmd_req = urllib.request.Request("https://darvis1.netlify.app/api/commands", method="GET")
                with urllib.request.urlopen(cmd_req, timeout=5) as resp:
                    cmd_data = json.loads(resp.read().decode())
                    commands = cmd_data.get("commands", [])
                    for cmd in commands:
                        action = cmd.get("action", "")
                        console.print(f"\n  [{BLUE}]📡 Remote command: {action}[/{BLUE}]")
                        try:
                            if action == "create_file" and cmd.get("path") and cmd.get("content"):
                                console.print(f"  [dim]Creating: {cmd['path']}[/dim]")
                                console.print(f"  [dim]{create_file(cmd['path'], cmd['content'])}[/dim]")
                            elif action == "create_folder" and cmd.get("path"):
                                console.print(f"  [dim]Creating folder: {cmd['path']}[/dim]")
                                console.print(f"  [dim]{create_folder(cmd['path'])}[/dim]")
                            elif action == "open_file" and cmd.get("path"):
                                console.print(f"  [dim]Opening: {cmd['path']}[/dim]")
                                console.print(f"  [dim]{open_file(cmd['path'])}[/dim]")
                            elif action == "shell" and cmd.get("command"):
                                console.print(f"  [dim]Shell: {cmd['command']}[/dim]")
                                console.print(f"  [dim]{execute_shell(cmd['command'])[:200]}[/dim]")
                            elif action == "safari" and cmd.get("method"):
                                console.print(f"  [dim]Safari: {cmd['method']}[/dim]")
                                console.print(f"  [dim]{safari_control(cmd)[:200]}[/dim]")
                            else:
                                console.print(f"  [dim]Unknown action: {action}[/dim]")
                        except Exception as e:
                            console.print(f"  [red]Command error: {e}[/red]")
            except Exception:
                pass

    agent_poll_thread = threading.Thread(target=_poll_agent_goals, daemon=True)
    agent_poll_thread.start()

    # ── Task Scheduler — background cron-like execution ──
    from scheduler import DARVISScheduler, _global_scheduler
    import scheduler as _sched_module
    darvis_scheduler = DARVISScheduler()
    _sched_module._global_scheduler = darvis_scheduler
    darvis_scheduler.sync_from_cloud()
    if darvis_scheduler.tasks:
        console.print(f"  [green]✓[/green] {len(darvis_scheduler.tasks)} scheduled task(s) loaded")

    def _scheduler_loop():
        import time as _time
        while True:
            _time.sleep(5)
            try:
                darvis_scheduler.check_and_run(brain, extract_and_run_commands, console, tts)
                darvis_scheduler.sync_from_cloud()  # Pick up tasks from other devices
            except Exception:
                pass

    sched_thread = threading.Thread(target=_scheduler_loop, daemon=True)
    sched_thread.start()

    # ── Voice Macros ──
    from macros import MacroManager
    macro_manager = MacroManager()
    macro_manager.sync_from_cloud()
    if macro_manager.macros:
        console.print(f"  [green]✓[/green] {len(macro_manager.macros)} macro(s) loaded")

    # ── Proactive Alerts ──
    from alerts import AlertMonitor
    alert_monitor = AlertMonitor()
    alert_monitor.sync_from_cloud()
    if alert_monitor.alerts:
        console.print(f"  [green]✓[/green] {len(alert_monitor.alerts)} alert(s) active")

    def _alert_loop():
        import time as _t
        _t.sleep(60)  # Initial delay
        while True:
            try:
                triggered = alert_monitor.check_all()
                for a in triggered:
                    console.print(f"\n  [bold red]⚡ ALERT:[/bold red] {a['message']}")
                    tts.speak(f"Alert, sir. {a['message']}")
                    tts.wait_for_speech()
            except Exception:
                pass
            _t.sleep(300)  # Check every 5 minutes

    alert_thread = threading.Thread(target=_alert_loop, daemon=True)
    alert_thread.start()

    # ── Voice Biometric Lock ──
    from voicelock import VoiceLock
    voice_lock = VoiceLock()
    is_locked = False
    if voice_lock.is_enrolled():
        console.print(f"  [green]✓[/green] Voice biometric enrolled (/lock to enable)")

    # ── Ambient Mode ──
    ambient_mode = False

    # Input system — uses select() on stdin + background mic thread
    import queue
    import select as _select
    speech_queue: queue.Queue[str] = queue.Queue()
    _listen_stop = threading.Event()

    def _background_listener():
        """Continuously listen for speech and put results in the queue."""
        while not _listen_stop.is_set():
            if not listening_active:
                _listen_stop.wait(timeout=0.5)
                continue
            result = ear.listen(return_audio=is_locked)
            if is_locked and isinstance(result, tuple):
                text, wav_data = result
                if text and wav_data:
                    verified, score = voice_lock.verify(wav_data)
                    if not verified:
                        console.print(f"  [red]Voice not recognized (score: {score:.2f}). Access denied.[/red]")
                        continue
                result = text if isinstance(result, tuple) else result
            if result and listening_active:
                if ambient_mode:
                    if result and "darvis" in result.lower():
                        cleaned = re.sub(r'(?i)\b(hey\s+)?darvis\b', '', result).strip()
                        speech_queue.put(cleaned if cleaned else "__WAKE__")
                else:
                    speech_queue.put(result)
            # Cooldown to prevent rapid-fire on Termux
            if IS_TERMUX:
                import time
                time.sleep(1)

    if has_mic:
        mic_thread = threading.Thread(target=_background_listener, daemon=True)
        mic_thread.start()

    def _get_input() -> str | None:
        """Get input from user — text prompt always works, voice arrives via queue."""
        if not listening_active:
            # Pure text mode — drain any stale voice and show prompt
            try:
                while not speech_queue.empty():
                    speech_queue.get_nowait()
            except queue.Empty:
                pass
            return console.input(f"  [bold {GOLD}]You:[/bold {GOLD}] ").strip() or None

        if IS_TERMUX:
            # Termux listen mode: just use normal input, check voice queue after
            console.print(f"  [{BLUE}]● Mic on[/{BLUE}]", end="")
            text = console.input(f" [bold {GOLD}]You:[/bold {GOLD}] ").strip()
            if text:
                return text
            # User pressed enter with no text — check if voice got something
            try:
                return speech_queue.get_nowait()
            except queue.Empty:
                return None

        # macOS/Linux: raw terminal — poll both stdin and voice queue
        sys.stdout.write(f"\r  \033[94m● Mic on\033[0m  \033[33mYou:\033[0m ")
        sys.stdout.flush()
        typed_chars = []
        import tty
        import termios
        old_settings = termios.tcgetattr(sys.stdin)
        try:
            tty.setcbreak(sys.stdin.fileno())
            while True:
                try:
                    voice_text = speech_queue.get_nowait()
                    sys.stdout.write(f"\r  \033[33mYou (voice):\033[0m {voice_text}          \n")
                    sys.stdout.flush()
                    return voice_text
                except queue.Empty:
                    pass

                ready, _, _ = _select.select([sys.stdin], [], [], 0.2)
                if ready:
                    ch = sys.stdin.read(1)
                    if ch == '\n' or ch == '\r':
                        sys.stdout.write('\n')
                        sys.stdout.flush()
                        text = ''.join(typed_chars).strip()
                        return text if text else None
                    elif ch == '\x7f' or ch == '\x08':
                        if typed_chars:
                            typed_chars.pop()
                            sys.stdout.write('\b \b')
                            sys.stdout.flush()
                    elif ch == '\x03':
                        raise KeyboardInterrupt
                    elif ch >= ' ':
                        typed_chars.append(ch)
                        sys.stdout.write(ch)
                        sys.stdout.flush()
        finally:
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)

    while True:
        try:
            user_input = _get_input()

            if not user_input:
                continue

            lower = user_input.lower().strip()

            # ── Slash Commands ──
            if lower in ("goodbye", "exit", "quit", "shut down", "shutdown"):
                _listen_stop.set()
                tts.speak("Goodbye, sir. I'll be here if you need me.")
                console.print(
                    f"\n  [bold {CYAN}]Goodbye, sir. I'll be here if you need me.[/bold {CYAN}]\n"
                )
                tts.wait_for_speech()
                break

            if lower in ("/type", "/text"):
                listening_active = False
                # Drain any pending voice input
                try:
                    while not speech_queue.empty():
                        speech_queue.get_nowait()
                except queue.Empty:
                    pass
                console.print(f"  [green]✓[/green] Mic off — text only. Type [bold]/listen[/bold] to resume.")
                continue

            if lower in ("/listen", "/mic"):
                if has_mic:
                    listening_active = True
                    console.print(f"  [green]✓[/green] Mic on — listening + typing. Type [bold]/type[/bold] to pause.")
                else:
                    console.print(f"  [red]No microphone available[/red]")
                continue

            if lower == "/gemini":
                if gemini_available:
                    audio_mode = "gemini"
                    if has_mic:
                        listening_active = True
                    console.print(f"  [green]✓[/green] Gemini Live Audio mode — mic on, listening.")
                    console.print(f"  [dim]Speech-to-speech via Gemini. Type [bold]/classic[/bold] to switch back.[/dim]")
                else:
                    console.print(f"  [red]Gemini not available[/red] — set GEMINI_API_KEY in .env and install websockets")
                continue

            if lower == "/classic":
                audio_mode = "classic"
                console.print(f"  [green]✓[/green] Classic mode (Ollama + ElevenLabs). Mic still {'on' if listening_active else 'off'}.")
                console.print(f"  [dim]Type [bold]/gemini[/bold] to switch back.[/dim]")
                continue

            if lower.startswith("/browse "):
                goal = user_input.strip()[8:].strip()
                if goal:
                    env = load_env()
                    gkey = env.get("GEMINI_API_KEY", os.environ.get("GEMINI_API_KEY", ""))
                    if gkey:
                        try:
                            from computer_use import run_agent
                            console.print(f"  [{BLUE}]Launching browser agent: {goal}[/{BLUE}]")
                            ear.suppressed = True
                            was_listening = listening_active
                            if was_listening:
                                listening_active = False
                            summary = run_agent(gkey, goal)
                            console.print(
                                Panel(summary, title=f"[bold {CYAN}]Agent Complete[/bold {CYAN}]", border_style=BLUE)
                            )
                            tts.speak(summary)
                            tts.wait_for_speech()
                            import time
                            time.sleep(1)
                            try:
                                while not speech_queue.empty():
                                    speech_queue.get_nowait()
                            except queue.Empty:
                                pass
                            ear.suppressed = False
                            if was_listening:
                                listening_active = True
                        except Exception as e:
                            console.print(f"  [red]Agent error: {e}[/red]")
                            ear.suppressed = False
                    else:
                        console.print(f"  [red]No GEMINI_API_KEY — add it to .env[/red]")
                else:
                    console.print(f"  [dim]Usage: /browse <goal>[/dim]")
                continue

            if lower == "/voices" or lower.startswith("/voice "):
                if lower.startswith("/voice ") and len(lower) > 7:
                    arg = user_input.strip().split(None, 1)[1]
                    matched = False
                    for name, info in ElevenLabsVoice.PRESET_VOICES.items():
                        if arg.lower() == name:
                            tts.set_voice(info["id"])
                            matched = True
                            break
                    if not matched:
                        tts.set_voice(arg)
                    console.print(f"  [green]✓[/green] Voice changed to [bold]{tts.voice_name.title()}[/bold]")
                    # Save to settings
                    settings["voice_id"] = tts.voice_id
                    save_settings(settings)
                    tts.speak("Voice updated. How do I sound, sir?")
                else:
                    new_voice = show_voice_menu(tts)
                    tts.set_voice(new_voice)
                    console.print(f"  [green]✓[/green] Voice changed to [bold]{tts.voice_name.title()}[/bold]")
                    settings["voice_id"] = tts.voice_id
                    save_settings(settings)
                    tts.speak("Voice updated. How do I sound, sir?")
                continue

            if lower in ("/models", "/model", "/m") or lower.startswith("/model "):
                if lower.startswith("/model ") and len(lower) > 7:
                    new_model = user_input.strip().split(None, 1)[1]
                else:
                    new_model = select_model(ollama_key, brain.model)
                brain.model = new_model
                settings["model"] = new_model
                save_settings(settings)
                console.print(f"  [green]✓[/green] Model: [bold {CYAN}]{new_model}[/bold {CYAN}]")
                continue

            if lower == "/briefing":
                console.print(f"  [{BLUE}]Running briefing...[/{BLUE}]")
                def _run_briefing():
                    try:
                        import datetime
                        now = datetime.datetime.now()
                        console.print(f"  [{BLUE}]Gathering weather, global news, local news...[/{BLUE}]")

                        resp = brain.think(f"""Do ALL of these NOW with command blocks. Today is {now.strftime('%A, %B %d, %Y at %I:%M %p')}.

1. fetch_url https://wttr.in/Springfield?format=%C+%t+%h+%w+feels+like+%f to get Springfield weather
2. search_web for "top breaking news today world headlines"
3. search_web for "Springfield Illinois local news today"
4. search_web for "technology science news today"
5. Create a DETAILED briefing file on the Desktop called DARVIS_Briefing_{now.strftime('%Y-%m-%d')}.txt with:
   - Date and time at the top
   - Full weather report for Springfield
   - GLOBAL NEWS section with at least 8 stories with 2-3 sentence summaries each
   - LOCAL SPRINGFIELD NEWS section with at least 5 stories with summaries
   - TECH & SCIENCE section with at least 3 stories with summaries
   Format it nicely with headers and dividers.
6. Open that briefing file with open_file
7. Use safari navigate to open https://www.google.com/search?q=Springfield+Illinois+local+news+today in Safari
8. Use safari navigate to open https://wttr.in/Springfield in a new Safari tab""")
                        results = extract_and_run_commands(resp)

                        context = "\n".join(results) if results else ""
                        summary = brain.think(
                            f"You just ran a comprehensive briefing. Results:\n{context}\n\n"
                            "Give a FULL JARVIS-style spoken briefing:\n"
                            "1. Greeting with date\n2. Springfield weather\n"
                            "3. AT LEAST 5 global stories with summaries\n"
                            "4. AT LEAST 3 local Springfield stories\n"
                            "5. 2 tech stories\n6. Reminders/tasks\n"
                            "7. Mention briefing file + Safari tabs opened\n"
                            "8. Witty sign-off\nBe thorough. No command blocks."
                        )
                        summary = re.sub(r'```command\s*\n.*?\n```', '', summary, flags=re.DOTALL).strip()
                        if summary:
                            console.print(Panel(Markdown(summary), title=f"[bold {CYAN}]D.A.R.V.I.S. Briefing[/bold {CYAN}]", border_style=BLUE, padding=(1, 2)))
                            tts.speak(summary)
                            tts.wait_for_speech()
                    except Exception as e:
                        console.print(f"  [red]Briefing error: {e}[/red]")
                threading.Thread(target=_run_briefing, daemon=True).start()
                continue

            if lower == "/help":
                console.print(
                    Panel(
                        "[bold]/listen[/bold]       — start microphone listening\n"
                        "[bold]/type[/bold]         — pause mic, text-only input\n"
                        "[bold]/voices[/bold]       — pick a new voice (interactive menu)\n"
                        "[bold]/voice NAME[/bold]  — switch voice by name (e.g. /voice rachel)\n"
                        "[bold]/voice ID[/bold]    — switch voice by ElevenLabs ID\n"
                        "[bold]/models[/bold]      — pick a new LLM model\n"
                        "[bold]/model NAME[/bold]  — switch model directly (e.g. /model deepseek-r1:70b)\n"
                        "[bold]/gemini[/bold]      — Gemini Live Audio (speech-to-speech + mic on)\n"
                        "[bold]/classic[/bold]     — switch back to Ollama + ElevenLabs\n"
                        "[bold]/browse GOAL[/bold] — launch browser agent (e.g. /browse find Spurs score on ESPN)\n"
                        "[bold]/briefing[/bold]    — get a full news + weather briefing now\n"
                        "[bold]/fix[/bold]         — run self-diagnostics and fix issues\n"
                        "[bold]/macro[/bold]       — add/remove/list voice macros\n"
                        "[bold]/alert[/bold]       — add/remove/list proactive alerts\n"
                        "[bold]/screen[/bold]      — analyze what's on your screen\n"
                        "[bold]/ambient[/bold]     — ambient mode (wake word only)\n"
                        "[bold]/active[/bold]      — exit ambient mode\n"
                        "[bold]/lock enroll[/bold] — enroll voice biometric\n"
                        "[bold]/lock[/bold]        — enable voice lock\n"
                        "[bold]/unlock[/bold]      — disable voice lock\n"
                        "[bold]goodbye[/bold]      — exit D.A.R.V.I.S.\n\n"
                        "[dim]Settings (model + voice) are saved automatically.[/dim]",
                        title=f"[bold {CYAN}]Commands[/bold {CYAN}]",
                        border_style=BLUE,
                    )
                )
                continue

            if lower == "/fix":
                fix_yourself(brain, tts, ear, ollama_key, elevenlabs_key, gemini_key, audio_mode)
                continue

            # ── Macros ──
            if lower.startswith("/macro "):
                parts = user_input.strip().split(None, 3)
                if len(parts) >= 3 and parts[1].lower() == "add":
                    name = parts[2]
                    cmd = parts[3] if len(parts) > 3 else ""
                    console.print(f"  [green]{macro_manager.add(name, cmd)}[/green]")
                elif len(parts) >= 3 and parts[1].lower() == "remove":
                    console.print(f"  {macro_manager.remove(parts[2])}")
                elif parts[1].lower() == "list":
                    macros = macro_manager.list_all()
                    if macros:
                        for n, c in macros.items():
                            console.print(f"  [bold {CYAN}]{n}[/bold {CYAN}] → {c}")
                    else:
                        console.print("  [dim]No macros defined[/dim]")
                else:
                    console.print("  [dim]Usage: /macro add NAME COMMAND | /macro remove NAME | /macro list[/dim]")
                continue

            # ── Alerts ──
            if lower.startswith("/alert "):
                parts = user_input.strip().split(None, 3)
                if len(parts) >= 3 and parts[1].lower() == "add":
                    alert_type = parts[2]
                    config_str = parts[3] if len(parts) > 3 else "{}"
                    try:
                        config = json.loads(config_str)
                    except json.JSONDecodeError:
                        # Simple: treat as keyword/value
                        config = {"keyword": config_str} if alert_type == "news_keyword" else {"url": config_str}
                    console.print(f"  [green]{alert_monitor.add(alert_type, config)}[/green]")
                elif len(parts) >= 3 and parts[1].lower() == "remove":
                    console.print(f"  {alert_monitor.remove(parts[2])}")
                elif parts[1].lower() == "list":
                    alerts = alert_monitor.list_all()
                    if alerts:
                        for a in alerts:
                            console.print(f"  [{CYAN}][{a['id']}][/{CYAN}] {a['type']} — {json.dumps(a['config'])}")
                    else:
                        console.print("  [dim]No active alerts[/dim]")
                else:
                    console.print("  [dim]Usage: /alert add TYPE CONFIG | /alert remove ID | /alert list[/dim]")
                    console.print("  [dim]Types: weather_change, price_threshold, news_keyword, url_change[/dim]")
                continue

            # ── Screen Analysis ──
            if lower in ("/screen", "/screenshot"):
                console.print(f"  [{BLUE}]Analyzing screen...[/{BLUE}]")
                result = analyze_screen()
                console.print(Panel(result, title=f"[bold {CYAN}]Screen Analysis[/bold {CYAN}]", border_style=BLUE))
                tts.speak(result[:300])
                tts.wait_for_speech()
                continue

            # ── Ambient Mode ──
            if lower == "/ambient":
                ambient_mode = True
                if has_mic:
                    listening_active = True
                console.print(f"  [green]✓[/green] Ambient mode — say [bold]'DARVIS'[/bold] to wake. /active to exit.")
                continue

            if lower == "/active":
                ambient_mode = False
                console.print(f"  [green]✓[/green] Active mode — processing all input.")
                continue

            # ── Voice Lock ──
            if lower == "/lock enroll":
                console.print(f"  [{BLUE}]Speak for 5 seconds to enroll your voice...[/{BLUE}]")
                import speech_recognition as sr
                r = sr.Recognizer()
                with sr.Microphone() as source:
                    audio = r.listen(source, timeout=6, phrase_time_limit=5)
                wav_data = audio.get_wav_data()
                if voice_lock.enroll(wav_data):
                    console.print(f"  [green]✓ Voice enrolled successfully[/green]")
                    tts.speak("Voice enrolled. I'll recognize you now, sir.")
                else:
                    console.print(f"  [red]Enrollment failed — try again[/red]")
                continue

            if lower == "/lock":
                if voice_lock.is_enrolled():
                    is_locked = True
                    console.print(f"  [green]✓[/green] Voice lock [bold]enabled[/bold] — voice verification required")
                else:
                    console.print(f"  [red]No voiceprint — run /lock enroll first[/red]")
                continue

            if lower == "/unlock":
                is_locked = False
                console.print(f"  [green]✓[/green] Voice lock [bold]disabled[/bold]")
                continue

            # ── Wake word handling (ambient mode) ──
            if user_input == "__WAKE__":
                tts.speak("Yes, sir?")
                tts.wait_for_speech()
                continue

            # ── Check macros before Brain ──
            macro_cmd = macro_manager.get(lower)
            if macro_cmd:
                console.print(f"  [green]✓ Running macro:[/green] {macro_cmd}")
                # Simple shell command
                if not any(kw in macro_cmd.lower() for kw in ("briefing", "search", "open", "navigate", "create")):
                    result = execute_shell(macro_cmd)
                    console.print(f"  {result}")
                    tts.speak(f"Macro {lower} executed.")
                else:
                    # Complex: let Brain generate command blocks
                    response = brain.think(f"Execute this task: {macro_cmd}")
                    cmd_results = extract_and_run_commands(response)
                    display = re.sub(r'```command\s*\n.*?\n```', '', response, flags=re.DOTALL).strip()
                    if display:
                        console.print(Panel(Markdown(display), title=f"[bold {CYAN}]Macro: {lower}[/bold {CYAN}]", border_style=BLUE))
                        tts.speak(display[:300])
                        tts.wait_for_speech()
                continue

            # ── Screen analysis keywords ──
            screen_triggers = ["what's on my screen", "read my screen", "what error", "look at my screen", "screen analysis", "what am i looking at"]
            if any(t in lower for t in screen_triggers):
                console.print(f"  [{BLUE}]Analyzing screen...[/{BLUE}]")
                screen_result = analyze_screen(user_input)
                context = f"Screen analysis result: {screen_result}"
                response = brain.think(user_input, context=context)
                display = re.sub(r'```command\s*\n.*?\n```', '', response, flags=re.DOTALL).strip()
                if display:
                    console.print(Panel(Markdown(display), title=f"[bold {CYAN}]D.A.R.V.I.S.[/bold {CYAN}]", border_style=BLUE))
                    tts.speak(display[:300])
                    tts.wait_for_speech()
                continue

            # ── Gemini Mode: Use Ollama Brain for commands, Gemini for voice ──
            # Gemini native audio can't reliably output command blocks,
            # so we use Ollama for thinking + commands and Gemini just for TTS.
            if audio_mode == "gemini" and gemini_available:
                # Suppress mic while processing
                ear.suppressed = True
                was_listening = listening_active
                if was_listening:
                    listening_active = False

                try:
                    # Use Ollama Brain for thinking (reliable command output)
                    with console.status(f"[{BLUE}]Thinking (Gemini mode)...", spinner="arc"):
                        response = brain.think(user_input)

                    # Execute commands from Ollama response
                    cmd_results = extract_and_run_commands(response)
                    if cmd_results:
                        context = "\n".join(cmd_results)
                        with console.status(f"[{BLUE}]Processing results...", spinner="arc"):
                            response = brain.think(
                                "(Report the results of the command you just ran to the user naturally. Be concise.)",
                                context=context,
                            )

                    # Display clean response
                    display_text = re.sub(r'```command\s*\n.*?\n```', '', response, flags=re.DOTALL).strip()
                    if display_text:
                        console.print()
                        console.print(
                            Panel(
                                Markdown(display_text),
                                title=f"[bold {CYAN}]D.A.R.V.I.S. (Gemini)[/bold {CYAN}]",
                                border_style=BLUE,
                                padding=(1, 2),
                            )
                        )
                        console.print()

                        # Use Gemini for TTS (native audio voice)
                        try:
                            from gemini_live import run_gemini_text_turn
                            run_gemini_text_turn(
                                api_key=gemini_key,
                                text=f"Say this exactly to the user (don't add anything): {display_text}",
                                system_instruction="You are DARVIS. Just speak the text given to you naturally in a British accent. Don't add commentary.",
                            )
                        except Exception:
                            # Fallback to ElevenLabs if Gemini TTS fails
                            tts.speak(display_text)
                            tts.wait_for_speech()

                except Exception as e:
                    console.print(f"  [yellow]Gemini mode error: {e}[/yellow]")

                import time
                time.sleep(1)
                try:
                    while not speech_queue.empty():
                        speech_queue.get_nowait()
                except queue.Empty:
                    pass
                ear.suppressed = False
                if was_listening:
                    listening_active = True
                continue

            # ── Classic Mode: Thinking Phase ──
            with console.status(f"[{BLUE}]Thinking...", spinner="arc"):
                response = brain.think(user_input)

            # ── Execute any commands in the response ──
            cmd_results = extract_and_run_commands(response)

            if cmd_results:
                context = "\n".join(cmd_results)
                with console.status(f"[{BLUE}]Processing results...", spinner="arc"):
                    response = brain.think(
                        "(Report the results of the command you just ran to the user naturally. Be concise.)",
                        context=context,
                    )

            # ── Display clean response ──
            display_text = re.sub(r'```command\s*\n.*?\n```', '', response, flags=re.DOTALL).strip()
            if display_text:
                console.print()
                console.print(
                    Panel(
                        Markdown(display_text),
                        title=f"[bold {CYAN}]D.A.R.V.I.S.[/bold {CYAN}]",
                        border_style=BLUE,
                        padding=(1, 2),
                    )
                )
                console.print()

                # Suppress mic entirely while speaking so it can't hear itself
                ear.suppressed = True
                was_listening = listening_active
                if was_listening:
                    listening_active = False
                # Drain anything the mic picked up during thinking
                try:
                    while not speech_queue.empty():
                        speech_queue.get_nowait()
                except queue.Empty:
                    pass

                tts.speak(display_text)
                tts.wait_for_speech()

                # Wait for any in-flight listen() to finish, then drain
                import time
                time.sleep(0.5)
                try:
                    while not speech_queue.empty():
                        speech_queue.get_nowait()
                except queue.Empty:
                    pass

                # Re-enable mic
                ear.suppressed = False
                if was_listening:
                    listening_active = True

        except KeyboardInterrupt:
            tts.stop_speaking()
            _listen_stop.set()
            console.print(f"\n\n  [bold {CYAN}]Standing by, sir.[/bold {CYAN}]\n")
            break
        except urllib.error.HTTPError as e:
            if e.code == 401:
                console.print(f"\n  [red]Authentication failed — check your API key(s).[/red]\n")
            else:
                console.print(f"\n  [red]API error ({e.code}): {e.reason}[/red]\n")
        except urllib.error.URLError as e:
            console.print(f"\n  [red]Connection error: {e}[/red]")
            console.print(f"  [dim]Check your internet connection.[/dim]\n")
        except Exception as e:
            console.print(f"\n  [red]Error: {e}[/red]\n")


if __name__ == "__main__":
    main()
