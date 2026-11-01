# Refresh Notion snapshot for Mind Dashboard universe

The `/dashboard` universe renders a Notion galaxy from a **checked-in snapshot** when `NOTION_TOKEN` is not on the server.

## Prefer live (when available)

If `NOTION_TOKEN` is set, `GET /api/mind/dashboard/status` calls the Notion REST API for page `40bb95f33e42814aacf8c3281b4f528d` (and children) and returns live stop-points. The snapshot remains a fallback / offline graph.

## Refresh via MCP (this box)

1. Use the **user-Notion** MCP connector (`notion-search`, `notion-fetch`).
2. Search for Mind OS / bot handoff pages; fetch each reachable page.
3. Rebuild `scripts/dashboard/notion-snapshot.json` (and the copy under `src/lib/mind/dashboard/notion-snapshot.json`) with:
   - `pages[]`: `{ id, title, url, parentId, lastEdited, excerpt, kind }`
   - `edges[]`: parent/child and mentions
   - `botPageMap`: bot id → page id
4. Commit on `dashboard-3d`. **Never invent pages** — only include search/fetch hits.
5. Note: Notion.so **blocks iframe embedding**. The in-world card shows title/excerpt + an **Open in Notion** link.

Primary handoff page `40b1aa27632381768d58cde0731f142a` may 404 in the connected workspace; use mirror `40bb95f33e42814aacf8c3281b4f528d` when that happens.
