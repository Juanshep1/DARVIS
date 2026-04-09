"""
D.A.R.V.I.S. Voice Macros — custom shortcuts that expand into actions.
Cloud-synced via Netlify Blobs. Local fallback to macros.json.
"""

import json
import urllib.request
import urllib.error
import threading
from pathlib import Path

CLOUD_URL = "https://darvis1.netlify.app/api/macros"
LOCAL_PATH = Path(__file__).parent / "macros.json"
TIMEOUT = 5


class MacroManager:
    def __init__(self):
        self._lock = threading.Lock()
        self.macros: dict[str, str] = {}
        self._load_local()

    def _load_local(self):
        if LOCAL_PATH.exists():
            try:
                self.macros = json.loads(LOCAL_PATH.read_text())
            except (json.JSONDecodeError, OSError):
                self.macros = {}

    def _save_local(self):
        LOCAL_PATH.write_text(json.dumps(self.macros, indent=2))

    def sync_from_cloud(self):
        try:
            req = urllib.request.Request(CLOUD_URL, method="GET")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.loads(resp.read().decode())
                cloud_macros = data.get("macros", {})
                if cloud_macros:
                    with self._lock:
                        self.macros.update(cloud_macros)
                        self._save_local()
        except Exception:
            pass

    def _sync_to_cloud(self):
        try:
            payload = json.dumps({"replace": True, "macros": self.macros}).encode()
            req = urllib.request.Request(
                CLOUD_URL, data=payload, method="POST",
                headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=TIMEOUT)
        except Exception:
            pass

    def add(self, name: str, command: str) -> str:
        with self._lock:
            self.macros[name.lower()] = command
            self._save_local()
        threading.Thread(target=self._sync_to_cloud, daemon=True).start()
        return f"Macro '{name}' saved: {command}"

    def remove(self, name: str) -> str:
        with self._lock:
            if name.lower() in self.macros:
                del self.macros[name.lower()]
                self._save_local()
                threading.Thread(target=self._sync_to_cloud, daemon=True).start()
                return f"Macro '{name}' removed"
            return f"Macro '{name}' not found"

    def get(self, name: str) -> str | None:
        with self._lock:
            return self.macros.get(name.lower())

    def list_all(self) -> dict[str, str]:
        with self._lock:
            return dict(self.macros)
