"""
S.P.E.C.T.R.A. Memory System — persistent memory across ALL devices.
Uses the Netlify cloud API as the single source of truth so terminal,
local web dashboard, and the deployed browser app all share one memory.
Falls back to local memory.json if the cloud is unreachable.
"""

import json
import datetime
import urllib.request
import urllib.error
from pathlib import Path

CLOUD_URL = "https://darvis1.netlify.app/api/memory"
LOCAL_PATH = Path(__file__).parent / "memory.json"
TIMEOUT = 8  # seconds


def _cloud_get() -> list[dict] | None:
    """Fetch all memories from the cloud store."""
    try:
        req = urllib.request.Request(CLOUD_URL, method="GET")
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode())
            return data.get("memories", [])
    except Exception:
        return None


def _cloud_post(content: str, category: str) -> dict | None:
    """Add a memory via the cloud API."""
    try:
        payload = json.dumps({"content": content, "category": category}).encode()
        req = urllib.request.Request(
            CLOUD_URL, data=payload, method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode())
            return data.get("memory")
    except Exception:
        return None


def _cloud_delete(memory_id: int) -> bool:
    """Delete a memory via the cloud API."""
    try:
        payload = json.dumps({"id": memory_id}).encode()
        req = urllib.request.Request(
            CLOUD_URL, data=payload, method="DELETE",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return True
    except Exception:
        return False


# ── Local fallback ───────────────────────────────────────────────────────────

def _local_load() -> list[dict]:
    if LOCAL_PATH.exists():
        try:
            return json.loads(LOCAL_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            return []
    return []


def _local_save(memories: list[dict]):
    LOCAL_PATH.write_text(json.dumps(memories, indent=2, default=str))


# ── Public API (used by spectra.py and web.py) ────────────────────────────────

def load_memory() -> list[dict]:
    """Load all memories. Tries cloud first, falls back to local."""
    cloud = _cloud_get()
    if cloud is not None:
        # Keep local file in sync
        _local_save(cloud)
        return cloud
    return _local_load()


def save_memory(memories: list[dict]):
    """Save memories locally (cloud writes go through add/forget)."""
    _local_save(memories)


def add_memory(content: str, category: str = "general") -> str:
    """Add a new memory. Writes to cloud first, falls back to local."""
    result = _cloud_post(content, category)
    if result:
        # Sync local copy
        cloud = _cloud_get()
        if cloud is not None:
            _local_save(cloud)
        return f"Remembered: {content}"

    # Fallback: local only
    memories = _local_load()
    entry = {
        "id": len(memories),
        "content": content,
        "category": category,
        "created": datetime.datetime.now().isoformat(),
    }
    memories.append(entry)
    _local_save(memories)
    return f"Remembered (local only): {content}"


def search_memory(query: str) -> list[dict]:
    """Search memories by keyword."""
    memories = load_memory()
    query_lower = query.lower()
    return [m for m in memories if query_lower in m["content"].lower()]


def forget_memory(memory_id: int) -> str:
    """Delete a memory by ID. Deletes from cloud first, falls back to local."""
    if _cloud_delete(memory_id):
        cloud = _cloud_get()
        if cloud is not None:
            _local_save(cloud)
        return f"Forgotten memory #{memory_id}"

    # Fallback: local only
    memories = _local_load()
    memories = [m for m in memories if m["id"] != memory_id]
    for i, m in enumerate(memories):
        m["id"] = i
    _local_save(memories)
    return f"Forgotten memory #{memory_id} (local only)"


def get_memory_context() -> str:
    """Get all memories formatted for injection into the system prompt."""
    memories = load_memory()
    if not memories:
        return ""
    lines = []
    for m in memories:
        lines.append(f"- [{m['category']}] {m['content']}")
    return "\n\nUser's saved memories (things they asked you to remember):\n" + "\n".join(lines)
