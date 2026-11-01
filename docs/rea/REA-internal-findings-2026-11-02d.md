# REA internal audit — pass d (authenticated live walk + GitHub verification)
Date: 2026-11-02 00:46 (Africa/Lagos, UTC+1). Site: https://adrians-mind.vercel.app (dedicated audit account). Code refs: preview/integration @ 4371f0e, media-storage-fleet @ cf0f304, main @ 714ad22.

## Ranked real blockers (survived GitHub check)
1. **forbidden_cross_site on every sidebar view** — emitted by `src/lib/auth/isolation.server.ts` (`assertSameSiteRequest`, enforced at authMiddleware via `middleware.ts`) and duplicated in `src/lib/mind/agent-run.server.ts:62-68`. It rejects any *scripted* request whose `Sec-Fetch-Site` is not `same-origin`/`none` (i.e. `same-site` or `cross-site`), unless it is a top-level GET navigation. So every server-fn/API fetch the sidebar views make is 403'd if the browser labels it same-site (e.g. served via a different host/alias than the API, vercel.app alias vs custom domain, or a proxy/iframe). Same code on main, preview/integration and media-storage-fleet — **no fix exists on any branch**. Client side only classifies it (`failure-states.ts:49,176`, `command-app.tsx:2225`).
2. **Sign-in redirect bug** (from live walk; not re-verified in code this pass — branches `mcp-integration-hotfix-signin` / `mcp-integration-list-signin-port` exist and are the likely fix candidates).
3. **Grok key "Not configured" / chip "Unavailable"** — CONFIRMED + root cause beyond missing env: `src/lib/mind/media/xai-key.ts` `resolveXaiInferenceApiKey()` returns `string | undefined` (main and preview/integration), but `src/lib/mind/server.ts:59` does `resolveXaiInferenceApiKey(process.env).ok` and `agent-run.server.ts:95-97` uses `keyed.ok`/`keyed.key`. `.ok` on a string is undefined → status is **always "unconfigured"** and agent-run always fails, even with a key set. Also the resolver prefers `/home/box/.secrets/xai_inference.env` (absent on Vercel), so Vercel also needs `XAI_API_KEY` set in project env. UI text from `service-board.tsx:140`.

## Refuted / expected
- **Effort picker no-op**: REFUTED in logic. `src/lib/mind/model-tiers.ts` maps Fast→grok-4.20-0309-non-reasoning, Expert→grok-4.5, Heavy→grok-4.7, Build→grok-build-0.1, Orchestrator→grok-4.7 (env overrides MIND_MODEL_*). The "This effort is not wired to a different model." line is **stale hard-coded copy** at `command-app.tsx:6517` (and :5037 for Build). Logic Bot lane — copy fix only; but tiers can't be exercised live while blocker 3 holds.
- **Artifacts/Canvas**: CONFIRMED absent. Routes on preview/integration: __root, api/, auth/, dashboard, explore, index, login, memory, personas — no artifacts/canvas route or component (only 3D-scene canvas files). Lock `media-integration-gap-artifacts-canvas.lock` exists (Media lane).
- **Realtime voice route**: CONFIRMED none under src/routes; voice lives in components (`live-voice-bar`, `voice-mode-overlay`) inside the shell.
- **404s for /projects /library /settings /connectors /mcp /tools /artifacts /voice /chat**: expected — these are in-app views on /, not routes.
- **Dashboard empty panels**: expected empty states for a fresh account / Vercel (no box, no NOTION_TOKEN, no git/lock history).

## Route-by-route
| Route | Result |
|---|---|
| / | Command OS shell renders; every sidebar view shows forbidden_cross_site banner |
| /dashboard | 3D Universe renders, session holds |
| /memory | Memory manager renders, defaults OFF |
| /explore | Persona directory renders |
| /projects /library /settings /connectors /mcp /tools /artifacts /voice /chat | 404 (views exist only in the / sidebar; artifacts/canvas does not exist at all) |

## Panel states (/dashboard)
Notion galaxy "NOTION_TOKEN unset"; Money "no spend source"; Time "no git/lock history on box"; Commits/Lock/Spend "no source yet"; Interior "Building data unavailable". Grok: "Not configured – No server key is visible to this page", header chip "Unavailable".

## Dead / broken controls
- Operator ⌘K "Close" does not close; pointer events intercepted by the 3D canvas.
- Chat view: main area blank, banner squeezed in a narrow column (layout bug).

Screenshots:
- Dashboard: file:///cursor/stores/store-aa1a75f9-a66f-4c2d-9e84-d64c1e922baa/grok-bot/agents/f74d9945-faa7-4ae6-9511-3ab6b31d2dfd/assets/8c21d5d6b5884518f7c7d6550a957ad87ef8d51271b5304fc568b4cdfc601e58.png
- Operator ⌘K: file:///cursor/stores/store-aa1a75f9-a66f-4c2d-9e84-d64c1e922baa/grok-bot/agents/f74d9945-faa7-4ae6-9511-3ab6b31d2dfd/assets/d3c9cb8eae35ffc01cfd6c1ecc73823aa6d365e1917e000a967483141b7d6890.webp
- Chat broken: file:///cursor/stores/store-aa1a75f9-a66f-4c2d-9e84-d64c1e922baa/grok-bot/agents/f74d9945-faa7-4ae6-9511-3ab6b31d2dfd/assets/a17efe5a564bed313f54603e691cd3637d71dd0ee359e0dc8821b8da3b3145f7.webp

## GitHub verification (tool calls)
1. cursor-github `search_code` {query:"forbidden_cross_site repo:emzylavish-art/adrians-mind-command-os"} → 0 results, incomplete_results=true (index unreliable; followed up with branch reads).
2. cursor-github `list_branches` {owner, repo, perPage:100} → confirmed preview/integration=4371f0e, media-storage-fleet=cf0f304, main=714ad22; signin hotfix branches present.
3. cursor-github `get_file_contents` {path:"src/lib/auth/isolation.server.ts", ref:"refs/heads/preview/integration"} → CONFIRMED emitter + Sec-Fetch-Site rule (blocker 1).
4. cursor-github `get_file_contents` {path:"src/lib/mind/media/xai-key.ts", ref:"refs/heads/preview/integration"} → CONFIRMED string-return resolver (blocker 3 type mismatch).
Supplementary (local `git grep`/`git show` on fetched origin refs, same repo): forbidden_cross_site across main/preview/integration/media-storage-fleet; server.ts:59 `.ok`; agent-run.server.ts:62-68,95-97; service-board.tsx:140; model-tiers.ts tier→model map; command-app.tsx:5037,6517; src/routes listing.

## Routing needed
- Blocker 1 (isolation.server.ts / agent-run): MCP-integration / security lane owner (auth middleware).
- Blocker 3 (xai-key return type vs callers + Vercel XAI_API_KEY env): XAI Verification lane (`xai-verification-merge.lock`); env set is a user/ops action.
- Stale effort copy: Logic Bot. ⌘K close / canvas pointer-events: Dashboard/Visual Polish. Chat layout: Visual Polish. Artifacts/Canvas: Media lane (existing lock).
