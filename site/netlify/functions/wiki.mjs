import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("darvis-wiki");
  const url = new URL(req.url);

  // ── GET — return index, single page, or schema ──
  if (req.method === "GET") {
    const pageId = url.searchParams.get("page");
    const wantSchema = url.searchParams.get("schema");

    if (pageId) {
      try {
        const page = await store.get(`page:${pageId}`, { type: "json" });
        if (!page) return Response.json({ error: "Page not found" }, { status: 404 });
        return Response.json({ page });
      } catch {
        return Response.json({ error: "Page not found" }, { status: 404 });
      }
    }

    if (wantSchema) {
      let schema = null;
      try { schema = await store.get("schema", { type: "json" }); } catch {}
      return Response.json({ schema: schema || getDefaultSchema() });
    }

    // Default: return index
    let index = null;
    try { index = await store.get("index", { type: "json" }); } catch {}
    return Response.json({ index: index || { pages: {}, sources: {} } });
  }

  // ── POST — actions ──
  if (req.method === "POST") {
    const body = await req.json();
    const action = body.action;

    // ── Upsert page ──
    if (action === "upsert_page" && body.page) {
      const page = body.page;
      if (!page.id || !page.title || !page.content) {
        return Response.json({ error: "Page needs id, title, content" }, { status: 400 });
      }

      // Set timestamps
      const now = new Date().toISOString();
      const existing = await store.get(`page:${page.id}`, { type: "json" }).catch(() => null);
      page.created = existing?.created || page.created || now;
      page.updated = now;
      page.type = page.type || "concept";
      page.tags = page.tags || [];
      page.links = page.links || [];
      page.sources = page.sources || [];

      // Save page
      await store.setJSON(`page:${page.id}`, page);

      // Update index
      let index = { pages: {}, sources: {} };
      try { const d = await store.get("index", { type: "json" }); if (d) index = d; } catch {}
      index.pages[page.id] = {
        title: page.title,
        type: page.type,
        tags: page.tags,
        summary: page.summary || page.content.substring(0, 120).replace(/[#\n]/g, " ").trim(),
        updated: page.updated,
      };
      await store.setJSON("index", index);

      return Response.json({ ok: true, page });
    }

    // ── Delete page ──
    if (action === "delete_page" && body.id) {
      await store.delete(`page:${body.id}`);

      let index = { pages: {}, sources: {} };
      try { const d = await store.get("index", { type: "json" }); if (d) index = d; } catch {}
      delete index.pages[body.id];
      await store.setJSON("index", index);

      return Response.json({ ok: true });
    }

    // ── Search ──
    if (action === "search" && body.query) {
      let index = { pages: {}, sources: {} };
      try { const d = await store.get("index", { type: "json" }); if (d) index = d; } catch {}

      const queryWords = body.query.toLowerCase().split(/\s+/);
      const results = [];

      for (const [id, entry] of Object.entries(index.pages)) {
        const text = `${entry.title} ${entry.summary || ""} ${(entry.tags || []).join(" ")}`.toLowerCase();
        const score = queryWords.filter(w => text.includes(w)).length;
        if (score > 0) results.push({ id, ...entry, score });
      }

      results.sort((a, b) => b.score - a.score);
      return Response.json({ results: results.slice(0, 10) });
    }

    // ── Ingest source (store raw, return source-id) ──
    if (action === "ingest_source" && body.content) {
      const sourceId = `src-${Date.now()}`;
      const source = {
        id: sourceId,
        title: body.title || "Untitled",
        type: body.type || "paste",
        ingested: new Date().toISOString(),
        size: body.content.length,
        pages_updated: [],
      };

      // Store raw content
      await store.set(`source-raw:${sourceId}`, body.content);
      // Store metadata
      await store.setJSON(`source:${sourceId}`, source);

      // Update index sources
      let index = { pages: {}, sources: {} };
      try { const d = await store.get("index", { type: "json" }); if (d) index = d; } catch {}
      index.sources[sourceId] = {
        title: source.title,
        ingested: source.ingested,
        pages_updated: [],
      };
      await store.setJSON("index", index);

      return Response.json({ ok: true, sourceId, source });
    }

    // ── Bulk upsert (for ingest results) ──
    if (action === "bulk_upsert" && Array.isArray(body.pages)) {
      const now = new Date().toISOString();
      let index = { pages: {}, sources: {} };
      try { const d = await store.get("index", { type: "json" }); if (d) index = d; } catch {}

      for (const page of body.pages) {
        if (!page.id || !page.title || !page.content) continue;
        const existing = await store.get(`page:${page.id}`, { type: "json" }).catch(() => null);
        page.created = existing?.created || page.created || now;
        page.updated = now;
        page.type = page.type || "concept";
        page.tags = page.tags || [];
        page.links = page.links || [];
        page.sources = page.sources || [];

        await store.setJSON(`page:${page.id}`, page);

        index.pages[page.id] = {
          title: page.title,
          type: page.type,
          tags: page.tags,
          summary: page.summary || page.content.substring(0, 120).replace(/[#\n]/g, " ").trim(),
          updated: page.updated,
        };
      }

      // Update source record if provided
      if (body.sourceId && index.sources[body.sourceId]) {
        index.sources[body.sourceId].pages_updated = body.pages.map(p => p.id);
      }

      await store.setJSON("index", index);
      return Response.json({ ok: true, count: body.pages.length });
    }

    // ── Update index ──
    if (action === "update_index" && body.index) {
      await store.setJSON("index", body.index);
      return Response.json({ ok: true });
    }

    // ── Update schema ──
    if (action === "update_schema" && body.schema) {
      await store.setJSON("schema", body.schema);
      return Response.json({ ok: true });
    }

    // ── Natural language ingest (called from chat.mjs) ──
    if (action === "natural_ingest" && body.content) {
     try {
      const OLLAMA_KEY = Netlify.env.get("OLLAMA_API_KEY");
      if (!OLLAMA_KEY) return Response.json({ reply: "OLLAMA_API_KEY not configured" });
      let contentToIngest = body.content;
      let title = contentToIngest.substring(0, 60).replace(/\n/g, " ").trim();
      let sourceType = "paste";

      // Check if URL
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
          return Response.json({ reply: `Couldn't fetch that URL, sir: ${e.message}` });
        }
      }

      // Store raw source
      const sourceId = `src-${Date.now()}`;
      await store.set(`source-raw:${sourceId}`, contentToIngest);
      await store.setJSON(`source:${sourceId}`, {
        id: sourceId, title, type: sourceType,
        ingested: new Date().toISOString(), size: contentToIngest.length, pages_updated: [],
      });

      // Load index
      let wIdx = { pages: {}, sources: {} };
      try { const d = await store.get("index", { type: "json" }); if (d) wIdx = d; } catch {}
      if (!wIdx.sources) wIdx.sources = {};
      wIdx.sources[sourceId] = { title, ingested: new Date().toISOString(), pages_updated: [] };

      const schema = await store.get("schema", { type: "json" }).catch(() => null);
      const instructions = schema?.instructions || "Extract entities and concepts, create wiki pages.";

      const MODEL = Netlify.env.get("DARVIS_MODEL") || "glm-5";
      const ingestPrompt = `You are a wiki maintainer. Process this source into wiki pages.

CURRENT WIKI INDEX:
${JSON.stringify(wIdx, null, 2)}

WIKI RULES:
${instructions}

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
          const llmData = await llmRes.json();
          const llmText = llmData.message?.content || "";
          const jsonMatch = llmText.match(/\{[\s\S]*"pages"[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
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
              await store.setJSON(`page:${p.id}`, p);
              wIdx.pages[p.id] = {
                title: p.title, type: p.type, tags: p.tags,
                summary: p.summary || p.content.substring(0, 120).replace(/[#\n]/g, " ").trim(),
                updated: now,
              };
            }
            wIdx.sources[sourceId].pages_updated = pages.map(p => p.id);
            await store.setJSON("index", wIdx);
            const pageList = pages.map(p => `  ${p.type}: ${p.title}`).join("\n");
            return Response.json({ reply: `Ingested into the wiki, sir. ${pages.length} pages created:\n${pageList}` });
          }
        }
        return Response.json({ reply: "Source stored but couldn't generate wiki pages. Raw content saved, sir." });
      } catch (e) {
        return Response.json({ reply: `Wiki processing error: ${e.message}. Raw source was saved.` });
      }
     } catch (outerErr) {
      return Response.json({ reply: `Wiki ingest crashed: ${outerErr.message}` });
     }
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  return new Response("Method not allowed", { status: 405 });
};

function getDefaultSchema() {
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
- If exists: merge new info into existing content, preserve what's there
- If new: create a page with id (type-slug format), title, markdown content, tags, links
- Add [[page-id]] cross-references between related pages
- Keep each page under 4000 chars
- Write a one-line summary for the index entry`,
  };
}

export const config = { path: "/api/wiki" };
