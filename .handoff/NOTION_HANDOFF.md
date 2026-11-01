# MCP Integration lane handoff

**Branch:** `mcp-integration` (pushed to origin)  
**Worktree:** `/workspace/mind-command-os-mcp`  
**Base:** `f2b88fd` (origin/main)  
**Date:** 2026-11-01 (Africa/Lagos)

## What existed before

- External MCP *client* in `src/lib/mind/mcp.ts`: save/probe/call remote Streamable HTTP MCP servers; Connected UI form; chat intent `askMcp`.
- Tools nav view (`FleetPanel` mode `tools`) with local tool catalog + page inspect — **no** MCP server toggles.
- Notion REST helper in `src/lib/mind/notion.ts` (search/read/append) — separate from MCP tools.
- No built-in MCP server, no registry with enabled flags, no `/api/mind/mcp/*` routes.
- No paired PC agent / HP pairing endpoints on this box (HP Pairing Bot worktree not present).
- `preview/tools-timeline` has a live tools timeline (not merged into this lane).

## What this lane added

1. **Built-in tools** (`src/lib/mind/mcp/tools.ts`):
   - `notion_read_page` / `notion_append_section` — Notion REST; honest “not configured” without `NOTION_TOKEN` / `NOTION_API_KEY`
   - `pc_run_shell` — calls `MIND_PC_AGENT_URL`/`PC_AGENT_URL` if set; else “No paired PC online”; allowlist or `confirm=true`
   - `pglite_query` — read-only SELECT/WITH/EXPLAIN against app SQL

2. **Registry** (`src/lib/mind/mcp/registry.ts`): built-in server + external URL/command registration; enabled flags in `.data/mind-mcp-registry/*.json`

3. **MCP HTTP** via `@modelcontextprotocol/sdk` (`builtin-server.ts`) at `/api/mind/mcp/builtin`

4. **API**: `/api/mind/mcp/servers`, `/tools`, `/call` + `mcpRegistry*` server fns

5. **UI**: Tools panel + Tools card toggles; chat MCP turns tagged `[ok]`/`[error]`

## Commits

- `93485fc` Add built-in MCP tool handlers and server registry.
- `05e189e` Expose built-in MCP over Streamable HTTP and registry API routes.
- `8b0980e` Wire Tools UI to MCP registry toggles and tool-result status.
- `c3a646f` Add MCP e2e script that calls pglite_query over HTTP.

## Verification

- `tsc --noEmit`: pass
- Src/lib tests: 226/226 pass (incl. new MCP tests)
- Full `npm test`: 4 pre-existing fails (missing gitignored `.grok/skills/og`)
- `npm run build`: pass
- E2E (`npm run mcp:e2e` / `scripts/mcp/e2e.mjs`): **pglite_query SELECT 1** returned `{"rowCount":1,"rows":[{"n":1}]}` via direct tool, registry, and MCP `tools/call`. Log: `/workspace/audit/mcp-integration/e2e.log`

## Honestly not working / unverified

- **Notion token** unset on box → `notion_*` tools return not configured (verified)
- **No paired PC** → `pc_run_shell` returns “No paired PC online” (verified)
- **Stdio command MCP** can be registered but is not executed in this lane
- App HTTP routes `/api/mind/mcp/*` require sign-in; e2e used the same handlers over a local MCP HTTP listener + in-process registry (not a signed-in browser session against vite on :8080)
- Target Notion handoff page may be unavailable in the connected workspace (other bots reported this)

## Off-limits respected

No styles/CSS, failure-states, model-tiers/xAI adapter, voice, media. `command-app.tsx` / `server.ts` touched only for Tools/MCP wiring.
