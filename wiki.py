"""
S.P.E.C.T.R.A. Wiki System — persistent, compounding knowledge base.
LLM-maintained wiki with entity pages, concept pages, and cross-references.
Syncs across all devices via Netlify Blobs cloud API.
"""

import json
import urllib.request
import urllib.error
from pathlib import Path

CLOUD_URL = "https://darvis1.netlify.app/api/wiki"
CACHE_DIR = Path(__file__).parent / "wiki_cache"
TIMEOUT = 10


def _ensure_cache():
    CACHE_DIR.mkdir(exist_ok=True)


def _cloud_get(params=""):
    try:
        req = urllib.request.Request(f"{CLOUD_URL}{params}", method="GET")
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return None


def _cloud_post(payload):
    try:
        data = json.dumps(payload).encode()
        req = urllib.request.Request(
            CLOUD_URL, data=data, method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return None


# ── Index ──

def get_index() -> dict:
    """Get the wiki index (page catalog)."""
    result = _cloud_get()
    if result and result.get("index"):
        _ensure_cache()
        (CACHE_DIR / "index.json").write_text(json.dumps(result["index"], indent=2))
        return result["index"]
    # Fallback to cache
    _ensure_cache()
    cache = CACHE_DIR / "index.json"
    if cache.exists():
        try:
            return json.loads(cache.read_text())
        except Exception:
            pass
    return {"pages": {}, "sources": {}}


# ── Pages ──

def get_page(page_id: str) -> dict | None:
    """Fetch a single wiki page by ID."""
    result = _cloud_get(f"?page={page_id}")
    if result and result.get("page"):
        _ensure_cache()
        (CACHE_DIR / f"{page_id}.json").write_text(json.dumps(result["page"], indent=2))
        return result["page"]
    # Fallback to cache
    _ensure_cache()
    cache = CACHE_DIR / f"{page_id}.json"
    if cache.exists():
        try:
            return json.loads(cache.read_text())
        except Exception:
            pass
    return None


def upsert_page(page: dict) -> bool:
    """Create or update a wiki page."""
    result = _cloud_post({"action": "upsert_page", "page": page})
    return result is not None and result.get("ok")


def delete_page(page_id: str) -> bool:
    """Delete a wiki page."""
    result = _cloud_post({"action": "delete_page", "id": page_id})
    return result is not None and result.get("ok")


def bulk_upsert(pages: list[dict], source_id: str = None) -> bool:
    """Upsert multiple pages at once (used after ingest)."""
    payload = {"action": "bulk_upsert", "pages": pages}
    if source_id:
        payload["sourceId"] = source_id
    result = _cloud_post(payload)
    return result is not None and result.get("ok")


# ── Search ──

def search_wiki(query: str) -> list[dict]:
    """Search wiki pages by keyword."""
    result = _cloud_post({"action": "search", "query": query})
    if result and result.get("results"):
        return result["results"]
    # Fallback: search local index cache
    index = get_index()
    query_words = query.lower().split()
    results = []
    for pid, entry in index.get("pages", {}).items():
        text = f"{entry.get('title', '')} {entry.get('summary', '')} {' '.join(entry.get('tags', []))}".lower()
        score = sum(1 for w in query_words if w in text)
        if score > 0:
            results.append({"id": pid, **entry, "score": score})
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:10]


# ── Sources ──

def ingest_source(title: str, content: str, source_type: str = "paste") -> str | None:
    """Store a raw source and return its source-id."""
    result = _cloud_post({
        "action": "ingest_source",
        "title": title,
        "content": content,
        "type": source_type,
    })
    if result and result.get("sourceId"):
        return result["sourceId"]
    return None


# ── Schema ──

def get_schema() -> dict:
    """Get wiki maintenance instructions."""
    result = _cloud_get("?schema=true")
    if result and result.get("schema"):
        return result["schema"]
    return {}


# ── Context for system prompt ──

def get_wiki_context(query: str) -> str:
    """Search wiki and return relevant pages formatted for system prompt injection."""
    if not query or len(query.strip()) < 3:
        return ""

    results = search_wiki(query)
    if not results:
        return ""

    # Fetch top 3 matching pages
    pages = []
    for r in results[:3]:
        page = get_page(r["id"])
        if page:
            pages.append(page)

    if not pages:
        return ""

    lines = ["\n\nRelevant wiki knowledge:"]
    for p in pages:
        content = p.get("content", "")
        if len(content) > 2000:
            content = content[:2000] + "..."
        lines.append(f"\n### {p.get('title', 'Untitled')} ({p.get('type', 'page')})")
        lines.append(content)

    return "\n".join(lines)


# ── Ingest prompt builder ──

def build_ingest_prompt(index: dict, schema: dict, raw_content: str, title: str) -> str:
    """Build the LLM prompt for processing a source into wiki pages."""
    index_str = json.dumps(index, indent=2)
    instructions = schema.get("instructions", "Extract entities and concepts, create/update wiki pages.")

    return f"""You are a wiki maintainer. Process this source document and integrate it into the wiki.

CURRENT WIKI INDEX:
{index_str}

WIKI RULES:
{instructions}

SOURCE DOCUMENT ({title}):
{raw_content}

YOUR TASK:
1. Read the source and identify key entities, concepts, and facts
2. Check the index — update existing pages or create new ones
3. Use id format: type-slug (e.g. person-juan, concept-llm-wiki, entity-openai)
4. Add [[page-id]] cross-references between related pages
5. Keep each page under 4000 characters

OUTPUT FORMAT — respond with ONLY this JSON, no other text:
{{"pages": [
  {{
    "id": "type-slug",
    "title": "Page Title",
    "type": "entity|concept|summary",
    "content": "# Page Title\\n\\nMarkdown content with [[cross-links]]...",
    "tags": ["tag1", "tag2"],
    "links": ["other-page-id"],
    "summary": "One-line summary for the index"
  }}
]}}"""
