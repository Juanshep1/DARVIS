#!/usr/bin/env python3
"""
SPECTRA Background Daemon — polls cloud for pending commands and executes them.
Runs as a macOS Launch Agent so commands from browser/iOS work without Terminal open.

Install: python3 spectra_daemon.py --install
Remove:  python3 spectra_daemon.py --uninstall
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
import subprocess
import argparse
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))

COMMANDS_URL = "https://darvis1.netlify.app/api/commands"
POLL_INTERVAL = 5  # seconds
LOG_FILE = Path.home() / "Library/Logs/spectra_daemon.log"
PLIST_NAME = "com.spectra.daemon"
PLIST_PATH = Path.home() / f"Library/LaunchAgents/{PLIST_NAME}.plist"


def log(msg):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    # Only write to log file — launchd stdout already goes here, so don't print() too
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def create_file(path, content):
    p = Path(path).expanduser()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return f"Created {p}"


def create_folder(path):
    p = Path(path).expanduser()
    p.mkdir(parents=True, exist_ok=True)
    return f"Created folder {p}"


def open_file(path):
    p = str(Path(path).expanduser())
    subprocess.run(["open", p], timeout=5)
    return f"Opened {p}"


def execute_shell(cmd):
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
        return result.stdout[:500] or result.stderr[:500] or "Done"
    except subprocess.TimeoutExpired:
        return "Timed out"
    except Exception as e:
        return str(e)


def safari_control(data):
    method = data.get("method", "")
    if method == "navigate":
        url = data.get("url", "")
        script = f'tell application "Safari" to open location "{url}"'
        subprocess.run(["osascript", "-e", script], timeout=5)
        return f"Navigated to {url}"
    return f"Safari {method}"


def play_music(query):
    """Search and play in Apple Music using the macOS URL scheme."""
    import urllib.parse
    encoded = urllib.parse.quote(query)
    # Use macOS `open` with Apple Music URL scheme — opens Music app and searches
    url = f"music://music.apple.com/search?term={encoded}"
    try:
        subprocess.run(["open", url], timeout=5)
        return f"Playing: {query}"
    except Exception as e:
        return f"Music error: {e}"


def music_control(command):
    """Control Apple Music playback via AppleScript."""
    cmd_map = {
        "pause": 'tell application "Music" to pause',
        "play": 'tell application "Music" to play',
        "stop": 'tell application "Music" to stop',
        "next": 'tell application "Music" to next track',
        "previous": 'tell application "Music" to previous track',
    }
    script = cmd_map.get(command.lower())
    if not script:
        return f"Unknown music command: {command}"
    try:
        subprocess.run(["osascript", "-e", script], timeout=5)
        return f"Music: {command}"
    except Exception as e:
        return f"Music control error: {e}"


_seen_ts = set()  # Track processed command timestamps to prevent double execution

def poll_and_execute():
    try:
        req = urllib.request.Request(COMMANDS_URL, method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        commands = data.get("commands", [])
        for cmd in commands:
            # Skip already-processed commands
            ts = cmd.get("ts", 0)
            if ts and ts in _seen_ts:
                continue
            if ts:
                _seen_ts.add(ts)
                # Keep set from growing forever
                if len(_seen_ts) > 100:
                    _seen_ts.clear()
            action = cmd.get("action", "")
            log(f"Executing: {action} — {json.dumps(cmd)}")
            try:
                if action == "create_file" and cmd.get("path") and cmd.get("content"):
                    result = create_file(cmd["path"], cmd["content"])
                    log(result)
                    time.sleep(0.5)  # Ensure file is fully written before opening
                    open_result = open_file(cmd["path"])
                    log(open_result)
                elif action == "create_folder" and cmd.get("path"):
                    log(create_folder(cmd["path"]))
                elif action == "open_file" and cmd.get("path"):
                    log(open_file(cmd["path"]))
                elif action == "shell" and cmd.get("command"):
                    log(f"Shell: {execute_shell(cmd['command'])}")
                elif action == "safari" and cmd.get("method"):
                    log(f"Safari: {safari_control(cmd)}")
                elif action == "play_music" and cmd.get("query"):
                    log(play_music(cmd["query"]))
                elif action == "music_control" and cmd.get("command"):
                    log(music_control(cmd["command"]))
                elif action == "wiki_ingest" and cmd.get("content"):
                    log(f"Wiki ingest: {cmd.get('title', 'Untitled')}")
                    try:
                        sys.path.insert(0, os.path.dirname(__file__))
                        from wiki import get_index, get_schema, ingest_source, bulk_upsert, build_ingest_prompt
                        import re as re_mod

                        raw = cmd["content"].strip()
                        title = cmd.get("title", "Untitled")

                        # If content is a URL, fetch it
                        if raw.startswith("http://") or raw.startswith("https://"):
                            log(f"Fetching URL: {raw}")
                            try:
                                url_req = urllib.request.Request(raw, headers={"User-Agent": "Mozilla/5.0"})
                                with urllib.request.urlopen(url_req, timeout=15) as url_resp:
                                    html = url_resp.read().decode(errors="replace")
                                title_match = re_mod.search(r'<title[^>]*>([^<]+)</title>', html, re_mod.IGNORECASE)
                                if title_match:
                                    title = title_match.group(1).strip()
                                raw = re_mod.sub(r'<[^>]+>', ' ', html)
                                raw = re_mod.sub(r'\s+', ' ', raw).strip()[:50000]
                                log(f"Fetched: {title} ({len(raw)} chars)")
                            except Exception as e:
                                log(f"URL fetch failed: {e}")
                                continue

                        # Store source
                        source_id = ingest_source(title, raw, "paste")
                        if not source_id:
                            log("Failed to store wiki source")
                            continue

                        # Build ingest prompt
                        index = get_index()
                        schema = get_schema()
                        prompt = build_ingest_prompt(index, schema, raw[:25000], title)

                        # Call Ollama API directly
                        env_path = Path(__file__).parent / ".env"
                        ollama_key = ""
                        if env_path.exists():
                            for line in env_path.read_text().splitlines():
                                if line.startswith("OLLAMA_API_KEY="):
                                    ollama_key = line.split("=", 1)[1].strip().strip('"')
                        if not ollama_key:
                            log("No OLLAMA_API_KEY found")
                            continue

                        payload = json.dumps({"model": "glm-5", "messages": [{"role": "user", "content": prompt}], "stream": False}).encode()
                        req2 = urllib.request.Request(
                            "https://ollama.com/api/chat", data=payload, method="POST",
                            headers={"Content-Type": "application/json", "Authorization": f"Bearer {ollama_key}"},
                        )
                        with urllib.request.urlopen(req2, timeout=120) as resp2:
                            result = json.loads(resp2.read().decode())

                        llm_text = result.get("message", {}).get("content", "")
                        json_match = re_mod.search(r'\{[\s\S]*"pages"[\s\S]*\}', llm_text)
                        if json_match:
                            parsed = json.loads(json_match.group())
                            pages = parsed.get("pages", [])
                            if pages:
                                for p in pages:
                                    p.setdefault("sources", [])
                                    if source_id not in p["sources"]:
                                        p["sources"].append(source_id)
                                if bulk_upsert(pages, source_id):
                                    log(f"Wiki: {len(pages)} pages created/updated")
                                    for p in pages:
                                        log(f"  {p.get('type', '?')}: {p.get('title', p['id'])}")
                                else:
                                    log("Wiki: Failed to write pages")
                            else:
                                log("Wiki: No pages in LLM output")
                        else:
                            log("Wiki: Could not parse LLM output")
                    except Exception as e:
                        log(f"Wiki ingest error: {e}")
                else:
                    log(f"Unknown action: {action}")
            except Exception as e:
                log(f"Error executing {action}: {e}")
    except Exception:
        pass  # Network error, try again next poll


LOCAL_CHAT_URL = "https://darvis1.netlify.app/api/wiki"  # Reuse wiki store for local chat
AGENT_STORE_URL = "https://darvis1.netlify.app"

def poll_local_chat():
    """Check for pending local chat requests and process them with local Ollama."""
    try:
        # Check for pending local chat request
        req = urllib.request.Request(
            f"{AGENT_STORE_URL}/api/wiki",
            method="POST",
            data=json.dumps({"action": "get_local_chat"}).encode(),
            headers={"Content-Type": "application/json"},
        )
        # Use a simpler approach: read from the darvis-agent blob store via commands endpoint
        # Actually, we need to read from Netlify Blobs directly. Let's use a dedicated endpoint.
        pass
    except Exception:
        pass


def process_local_chat():
    """Poll for local chat requests from browser and process with local Ollama."""
    try:
        # Read pending_local_chat from darvis-agent store
        # We'll add a simple GET endpoint to the commands function for this
        req = urllib.request.Request(
            f"{AGENT_STORE_URL}/api/commands?local_chat=true",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())

        chat_req = data.get("local_chat")
        if not chat_req or not chat_req.get("messages"):
            return

        model = chat_req.get("model", "nimble-athena-unclothed")
        messages = chat_req["messages"]
        request_id = chat_req.get("id", "")

        log(f"Local chat: {model} (request {request_id})")

        # Call local Ollama
        payload = json.dumps({"model": model, "messages": messages, "stream": False}).encode()
        ollama_req = urllib.request.Request(
            "http://localhost:11434/api/chat",
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(ollama_req, timeout=120) as ollama_resp:
            result = json.loads(ollama_resp.read().decode())

        reply = result.get("message", {}).get("content", "No response")
        log(f"Local chat response: {reply[:100]}...")

        # Store response back
        resp_payload = json.dumps({
            "action": "store_local_response",
            "id": request_id,
            "reply": reply,
        }).encode()
        store_req = urllib.request.Request(
            f"{AGENT_STORE_URL}/api/commands",
            data=resp_payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(store_req, timeout=10)

    except urllib.error.URLError:
        pass  # Local Ollama not running
    except Exception as e:
        if "local_chat" in str(e).lower() or "connection refused" in str(e).lower():
            pass
        else:
            log(f"Local chat error: {e}")


def run_daemon():
    log("SPECTRA daemon started")
    while True:
        poll_and_execute()
        process_local_chat()
        time.sleep(POLL_INTERVAL)


def install():
    """Install as macOS Launch Agent (starts on login, runs in background)."""
    script_path = os.path.abspath(__file__)
    python_path = sys.executable

    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{python_path}</string>
        <string>{script_path}</string>
        <string>--run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>{LOG_FILE}</string>
    <key>WorkingDirectory</key>
    <string>{os.path.dirname(script_path)}</string>
</dict>
</plist>"""

    PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    PLIST_PATH.write_text(plist)
    subprocess.run(["launchctl", "load", str(PLIST_PATH)])
    print(f"Installed and started SPECTRA daemon")
    print(f"  Plist: {PLIST_PATH}")
    print(f"  Log: {LOG_FILE}")
    print(f"  Polls {COMMANDS_URL} every {POLL_INTERVAL}s")


def uninstall():
    """Remove the Launch Agent."""
    if PLIST_PATH.exists():
        subprocess.run(["launchctl", "unload", str(PLIST_PATH)])
        PLIST_PATH.unlink()
        print("SPECTRA daemon uninstalled")
    else:
        print("Daemon not installed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--install", action="store_true", help="Install as macOS Launch Agent")
    parser.add_argument("--uninstall", action="store_true", help="Remove Launch Agent")
    parser.add_argument("--run", action="store_true", help="Run the daemon (used by launchd)")
    args = parser.parse_args()

    if args.install:
        install()
    elif args.uninstall:
        uninstall()
    elif args.run:
        run_daemon()
    else:
        parser.print_help()
        print("\nQuick start: python3 spectra_daemon.py --install")
