"""
D.A.R.V.I.S. Memory System — persistent memory across devices.
Stores facts, preferences, and context the user wants remembered.
Synced via the git repo or shared storage.
"""

import json
import datetime
from pathlib import Path

MEMORY_PATH = Path(__file__).parent / "memory.json"


def load_memory() -> list[dict]:
    """Load all memories from disk."""
    if MEMORY_PATH.exists():
        try:
            return json.loads(MEMORY_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            return []
    return []


def save_memory(memories: list[dict]):
    """Save memories to disk."""
    MEMORY_PATH.write_text(json.dumps(memories, indent=2, default=str))


def add_memory(content: str, category: str = "general") -> str:
    """Add a new memory."""
    memories = load_memory()
    entry = {
        "id": len(memories),
        "content": content,
        "category": category,
        "created": datetime.datetime.now().isoformat(),
    }
    memories.append(entry)
    save_memory(memories)
    return f"Remembered: {content}"


def search_memory(query: str) -> list[dict]:
    """Search memories by keyword."""
    memories = load_memory()
    query_lower = query.lower()
    return [m for m in memories if query_lower in m["content"].lower()]


def forget_memory(memory_id: int) -> str:
    """Delete a memory by ID."""
    memories = load_memory()
    memories = [m for m in memories if m["id"] != memory_id]
    # Re-index
    for i, m in enumerate(memories):
        m["id"] = i
    save_memory(memories)
    return f"Forgotten memory #{memory_id}"


def get_memory_context() -> str:
    """Get all memories formatted for injection into the system prompt."""
    memories = load_memory()
    if not memories:
        return ""
    lines = []
    for m in memories:
        lines.append(f"- [{m['category']}] {m['content']}")
    return "\n\nUser's saved memories (things they asked you to remember):\n" + "\n".join(lines)
