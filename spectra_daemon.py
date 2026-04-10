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


def poll_and_execute():
    try:
        req = urllib.request.Request(COMMANDS_URL, method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        commands = data.get("commands", [])
        for cmd in commands:
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
                else:
                    log(f"Unknown action: {action}")
            except Exception as e:
                log(f"Error executing {action}: {e}")
    except Exception:
        pass  # Network error, try again next poll


def run_daemon():
    log("SPECTRA daemon started")
    while True:
        poll_and_execute()
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
