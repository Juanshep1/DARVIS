"""
S.P.E.C.T.R.A. Conversation History — shared across all devices.
Uses the Netlify cloud API as the single source of truth.
Falls back to local history.json if the cloud is unreachable.
"""

import json
import urllib.request
import urllib.error
from pathlib import Path

CLOUD_URL = "https://darvis1.netlify.app/api/history"
LOCAL_PATH = Path(__file__).parent / "history.json"
MAX_MESSAGES = 40
TIMEOUT = 8


def _cloud_get() -> list[dict] | None:
    try:
        req = urllib.request.Request(CLOUD_URL, method="GET")
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode())
            return data.get("messages", [])
    except Exception:
        return None


def _cloud_save(messages: list[dict]) -> bool:
    try:
        payload = json.dumps({"messages": messages}).encode()
        req = urllib.request.Request(
            CLOUD_URL, data=payload, method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return True
    except Exception:
        return False


def _local_load() -> list[dict]:
    if LOCAL_PATH.exists():
        try:
            return json.loads(LOCAL_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            return []
    return []


def _local_save(messages: list[dict]):
    LOCAL_PATH.write_text(json.dumps(messages, indent=2, default=str))


def load_history() -> list[dict]:
    """Load conversation history. Cloud first, local fallback."""
    cloud = _cloud_get()
    if cloud is not None:
        _local_save(cloud)
        return cloud
    return _local_load()


def save_history(messages: list[dict]):
    """Save conversation history to cloud + local."""
    # Trim
    if len(messages) > MAX_MESSAGES:
        messages = messages[-MAX_MESSAGES:]
    _local_save(messages)
    _cloud_save(messages)


def append_history(user_msg: dict, assistant_msg: dict):
    """Append a user+assistant exchange and sync."""
    messages = load_history()
    messages.append(user_msg)
    messages.append(assistant_msg)
    if len(messages) > MAX_MESSAGES:
        messages = messages[-MAX_MESSAGES:]
    _local_save(messages)
    _cloud_save(messages)
    return messages


def clear_history():
    """Clear all conversation history."""
    _local_save([])
    try:
        payload = b""
        req = urllib.request.Request(
            CLOUD_URL, data=payload, method="DELETE",
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=TIMEOUT)
    except Exception:
        pass
