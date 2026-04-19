import { Hono } from "hono";
import type { Env } from "../env";
import { kvDelete, kvGetJSON, kvGetText, kvSetJSON, kvSetText } from "../lib/kv";

export const wikiRoutes = new Hono<{ Bindings: Env }>();

interface WikiIndex {
  pages: Record<string, PageIndex>;
  sources: Record<string, SourceIndex>;
}
interface PageIndex { title: string; type: string; tags: string[]; summary: string; updated: string }
interface SourceIndex { title: string; ingested: string; pages_updated: string[] }
interface Page {
  id: string;
  title: string;
  content: string;
  type?: string;
  tags?: string[];
  links?: string[];
  sources?: string[];
  summary?: string;
  created?: string;
  updated?: string;
}

function defaultSchema() {
  return {
    page_types: ["entity", "concept", "summary", "source-meta"],
    naming: "type-slug (e.g. person-juan, concept-llm-wiki)",
    max_page_length: 4000,
    instructions: `When ingesting a source, extract:
1. Entities (people, places, organizations, projects, tools) → type: entity
2. Concepts (ideas, techniques, patterns, methodologies) → type: concept
3. Key summaries or syntheses → type: summary

For each extraction:
- Check if a page already exists (match by title/tags in the index)
- If exists: UPDATE the page with the new info. If new info CONTRADICTS old info, the new info is correct — REPLACE the old facts, don't keep both
- If new: create a page with id (type-slug format), title, markdown content, tags, links
- Add [[page-id]] cross-references between related pages
- Keep each page under 4000 chars
- Write a one-line summary for the index entry
- The user's own statements about themselves are always authoritative`,
  };
}

function summarize(content: string, summary?: string): string {
  if (summary) return summary;
  return content.substring(0, 120).replace(/[#\n]/g, " ").trim();
}

wikiRoutes.get("/", async (c) => {
  const pageId = c.req.query("page");
  const wantSchema = c.req.query("schema");
  if (pageId) {
    const page = await kvGetJSON<Page>(c.env, "wiki", `page:${pageId}`);
    if (!page) return c.json({ error: "Page not found" }, 404);
    return c.json({ page });
  }
  if (wantSchema) {
    const schema = await kvGetJSON(c.env, "wiki", "schema");
    return c.json({ schema: schema || defaultSchema() });
  }
  const index = (await kvGetJSON<WikiIndex>(c.env, "wiki", "index")) || { pages: {}, sources: {} };
  return c.json({ index });
});

wikiRoutes.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const action = body.action as string | undefined;

  if (action === "upsert_page" && body.page) {
    const page = body.page as Page;
    if (!page.id || !page.title || !page.content) return c.json({ error: "Page needs id, title, content" }, 400);
    const now = new Date().toISOString();
    const existing = await kvGetJSON<Page>(c.env, "wiki", `page:${page.id}`);
    page.created = existing?.created || page.created || now;
    page.updated = now;
    page.type = page.type || "concept";
    page.tags = page.tags || [];
    page.links = page.links || [];
    page.sources = page.sources || [];
    await kvSetJSON(c.env, "wiki", `page:${page.id}`, page);
    const index = (await kvGetJSON<WikiIndex>(c.env, "wiki", "index")) || { pages: {}, sources: {} };
    index.pages[page.id] = {
      title: page.title,
      type: page.type,
      tags: page.tags,
      summary: summarize(page.content, page.summary),
      updated: page.updated,
    };
    await kvSetJSON(c.env, "wiki", "index", index);
    return c.json({ ok: true, page });
  }

  if (action === "delete_page" && body.id) {
    const id = body.id as string;
    await kvDelete(c.env, "wiki", `page:${id}`);
    const index = (await kvGetJSON<WikiIndex>(c.env, "wiki", "index")) || { pages: {}, sources: {} };
    delete index.pages[id];
    await kvSetJSON(c.env, "wiki", "index", index);
    return c.json({ ok: true });
  }

  if (action === "search" && body.query) {
    const index = (await kvGetJSON<WikiIndex>(c.env, "wiki", "index")) || { pages: {}, sources: {} };
    const query = String(body.query).toLowerCase();
    const queryWords = query.split(/\s+/);
    const results: (PageIndex & { id: string; score: number })[] = [];
    for (const [id, entry] of Object.entries(index.pages)) {
      const text = `${entry.title} ${entry.summary || ""} ${(entry.tags || []).join(" ")}`.toLowerCase();
      const score = queryWords.filter((w) => text.includes(w)).length;
      if (score > 0) results.push({ id, ...entry, score });
    }
    results.sort((a, b) => b.score - a.score);
    return c.json({ results: results.slice(0, 10) });
  }

  if (action === "ingest_source" && body.content) {
    const sourceId = `src-${Date.now()}`;
    const source = {
      id: sourceId,
      title: (body.title as string) || "Untitled",
      type: (body.type as string) || "paste",
      ingested: new Date().toISOString(),
      size: String(body.content).length,
      pages_updated: [] as string[],
    };
    await kvSetText(c.env, "wiki", `source-raw:${sourceId}`, String(body.content));
    await kvSetJSON(c.env, "wiki", `source:${sourceId}`, source);
    const index = (await kvGetJSON<WikiIndex>(c.env, "wiki", "index")) || { pages: {}, sources: {} };
    index.sources[sourceId] = { title: source.title, ingested: source.ingested, pages_updated: [] };
    await kvSetJSON(c.env, "wiki", "index", index);
    return c.json({ ok: true, sourceId, source });
  }

  if (action === "bulk_upsert" && Array.isArray(body.pages)) {
    const now = new Date().toISOString();
    const index = (await kvGetJSON<WikiIndex>(c.env, "wiki", "index")) || { pages: {}, sources: {} };
    for (const page of body.pages as Page[]) {
      if (!page.id || !page.title || !page.content) continue;
      const existing = await kvGetJSON<Page>(c.env, "wiki", `page:${page.id}`);
      page.created = existing?.created || page.created || now;
      page.updated = now;
      page.type = page.type || "concept";
      page.tags = page.tags || [];
      page.links = page.links || [];
      page.sources = page.sources || [];
      await kvSetJSON(c.env, "wiki", `page:${page.id}`, page);
      index.pages[page.id] = {
        title: page.title,
        type: page.type,
        tags: page.tags,
        summary: summarize(page.content, page.summary),
        updated: page.updated,
      };
    }
    if (body.sourceId && index.sources[body.sourceId as string]) {
      index.sources[body.sourceId as string].pages_updated = (body.pages as Page[]).map((p) => p.id);
    }
    await kvSetJSON(c.env, "wiki", "index", index);
    return c.json({ ok: true, count: (body.pages as Page[]).length });
  }

  if (action === "update_index" && body.index) {
    await kvSetJSON(c.env, "wiki", "index", body.index);
    return c.json({ ok: true });
  }

  if (action === "update_schema" && body.schema) {
    await kvSetJSON(c.env, "wiki", "schema", body.schema);
    return c.json({ ok: true });
  }

  if (action === "natural_ingest" && body.content) {
    const OLLAMA_KEY = c.env.OLLAMA_API_KEY;
    if (!OLLAMA_KEY) return c.json({ reply: "OLLAMA_API_KEY not configured" });
    let contentToIngest = String(body.content);
    let title = contentToIngest.substring(0, 60).replace(/\n/g, " ").trim();
    let sourceType: "paste" | "url" = "paste";
    if (contentToIngest.match(/^https?:\/\//)) {
      title = contentToIngest.trim();
      sourceType = "url";
      try {
        const fetchRes = await fetch(contentToIngest.trim(), { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
        const html = await fetchRes.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) title = titleMatch[1].trim();
        contentToIngest = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 50000);
      } catch (e) {
        return c.json({ reply: `Couldn't fetch that URL, sir: ${(e as Error).message}` });
      }
    }

    const sourceId = `src-${Date.now()}`;
    await kvSetText(c.env, "wiki", `source-raw:${sourceId}`, contentToIngest);
    await kvSetJSON(c.env, "wiki", `source:${sourceId}`, {
      id: sourceId, title, type: sourceType,
      ingested: new Date().toISOString(), size: contentToIngest.length, pages_updated: [],
    });

    const wIdx = (await kvGetJSON<WikiIndex>(c.env, "wiki", "index")) || { pages: {}, sources: {} };
    wIdx.sources[sourceId] = { title, ingested: new Date().toISOString(), pages_updated: [] };
    const schema = (await kvGetJSON<ReturnType<typeof defaultSchema>>(c.env, "wiki", "schema")) || defaultSchema();
    const MODEL = c.env.DARVIS_MODEL || "gpt-oss:120b-cloud";
    const ingestPrompt = `You are a wiki maintainer. Process this source into wiki pages.

CURRENT WIKI INDEX:
${JSON.stringify(wIdx, null, 2)}

WIKI RULES:
${schema.instructions}

SOURCE (${title}):
${contentToIngest.substring(0, 30000)}

Output ONLY JSON: {"pages": [{"id": "type-slug", "title": "...", "type": "entity|concept|summary", "content": "markdown...", "tags": [...], "links": [...], "summary": "one line"}]}`;

    try {
      const llmRes = await fetch("https://ollama.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
        body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: ingestPrompt }], stream: false }),
        signal: AbortSignal.timeout(100000),
      });
      if (llmRes.ok) {
        const llmData = (await llmRes.json()) as { message?: { content?: string } };
        const llmText = llmData.message?.content || "";
        const jsonMatch = llmText.match(/\{[\s\S]*"pages"[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { pages?: Page[] };
          const pages = parsed.pages || [];
          const now = new Date().toISOString();
          for (const p of pages) {
            if (!p.id || !p.title || !p.content) continue;
            p.type = p.type || "concept";
            p.tags = p.tags || [];
            p.links = p.links || [];
            p.sources = [sourceId];
            p.created = now;
            p.updated = now;
            await kvSetJSON(c.env, "wiki", `page:${p.id}`, p);
            wIdx.pages[p.id] = {
              title: p.title,
              type: p.type!,
              tags: p.tags!,
              summary: summarize(p.content, p.summary),
              updated: now,
            };
          }
          wIdx.sources[sourceId].pages_updated = pages.map((p) => p.id);
          await kvSetJSON(c.env, "wiki", "index", wIdx);
          const pageList = pages.map((p) => `  ${p.type}: ${p.title}`).join("\n");
          return c.json({ reply: `Ingested into the wiki, sir. ${pages.length} pages created:\n${pageList}` });
        }
      }
      return c.json({ reply: "Source stored but couldn't generate wiki pages. Raw content saved, sir." });
    } catch (e) {
      return c.json({ reply: `Wiki processing error: ${(e as Error).message}. Raw source was saved.` });
    }
  }

  return c.json({ error: "Unknown action" }, 400);
});

// Expose raw source text too (some callers do /api/wiki?source-raw=ID)
wikiRoutes.get("/source-raw", async (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ error: "missing id" }, 400);
  const text = await kvGetText(c.env, "wiki", `source-raw:${id}`);
  if (!text) return c.json({ error: "not found" }, 404);
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});
