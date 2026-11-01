# Voice Integration Bot — local handoff mirror
Notion page https://app.notion.com/p/40bb95f33e42814aacf8c3281b4f528d used (Error Banners Bot mirror page in connected workspace).

## 2026-11-01T12:03:11+01:00 — Voice Integration Bot — end-to-end voice
- Lane: voice-integration / worktree /workspace/mind-command-os-voice-integration
- Base: voice-wiring f2f6b60
- Commits: feaae3f, 1625912, 6362940, 6314004
- Works: capture-only STT via realtime (auto-reply cancelled) → Direct/Orchestrator → force_message/TTS speak; real level waveform; mute; secrets-file voice key; docs-correct client_secrets
- Live verified: client_secrets 200; TTS 200/91724 bytes; STT 200 "Say hello in one word."; capture-only+force 45600 PCM bytes. See /workspace/voice-test/integration-verify.json
- Mocked/blocked: Ollama unreachable (honest); browser mic not headless-tested; visual polish CSS untouched
- Tests: typecheck pass; 222/222 mind tests; build pass; scripts/** .grok/skills/og pre-existing fail
- Notion: appended to page 40bb95f3-3e42-814a-acf8-c3281b4f528d (Error Banners Bot mirror page)

# Notion handoff mirror

Primary page `https://app.notion.com/p/40b1aa27632381768d58cde0731f142a` returned **404** from the connected Notion workspace (same as other lanes).

Appended instead to mirror page `https://app.notion.com/p/40bb95f33e42814aacf8c3281b4f528d`:
- **Media Integration — results** (2026-11-01)
- **Media Integration — stop-point** (status: **complete**)

Full local write-up: `MEDIA_HANDOFF.md`.

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

## Notion append attempt

Tried `notion-update-page` insert_content on page `40b1aa27632381768d58cde0731f142a` via user-Notion MCP.
**Result:** 404 `object_not_found` — page not in the connected workspace / integration lacks access.
No substitute page was created. This file is the durable handoff mirror.

## Stop-point posted to mirror (2026-11-01, Africa/Lagos)

Appended section **mcp-integration stop-point** to Notion mirror page
`40bb95f33e42814aacf8c3281b4f528d`
(https://app.notion.com/p/40bb95f33e42814aacf8c3281b4f528d).
`notion-update-page` `insert_content` at end succeeded (returned page id).
Status recorded as `complete` (typecheck, 226/226 src tests, build passed;
e2e `pglite_query` SELECT 1 verified). Primary page `40b1aa27…` remains 404.

## Gap: OAuth connectors (2026-11-01, Africa/Lagos)

Shipped Notion OAuth Connect on ServiceBoard (authorization code + state + PKCE).
Routes: `/api/mind/oauth/notion/{start,callback,status,disconnect}`.
Tokens encrypted server-side (`CONNECTOR_TOKEN_SECRET`); never returned to client.
Disconnect clears store (+ revoke when `NOTION_OAUTH_REVOKE_URL` set).
MCP Notion tools use OAuth token when present.
E2E mock flow logged at `/workspace/audit/mcp-integration/oauth-e2e.log`.
Live provider connect **unverified** — no `NOTION_OAUTH_CLIENT_*` on box env
(did not read other apps/browsers/connectors).
Avoided `command-app.tsx` / `server.ts` / `styles.css` / voice / media / research.

Notion mirror append for OAuth gap succeeded on page 40bb95f3… (status done).

## Hardening pass (2026-11-01, Africa/Lagos)

1. PC pairing contract + pc_run_shell (8749cbd)
2. pglite_query harden + pglite_list_schema (befbaa6)
3. Tools UI nested servers/tools + toggle gate (823ee77)
4. Live verify script against vite :8083 (see /workspace/audit/mcp-integration/live-verify.log)
   - Auth-gated UI routes return honest 401 without session
   - `/api/mind/mcp/builtin` initialize + tools/call work without session

## Gap done: OAuth beyond Notion (2026-11-01 Africa/Lagos)

**Status:** done (typecheck + mind/src tests + build passed; live provider connects UNVERIFIED — no real client creds in env)

### Providers shipped
- **Google** (one OAuth client): Gmail, Google Calendar, Google Drive — separate ServiceBoard rows + connector ids `gmail` / `google_calendar` / `google_drive` with per-service scopes
- **Slack** (`slack`)
- **GitHub** (`github`)
- Notion unchanged via shared provider core (dedicated routes kept)

### Pattern
- Shared `oauth-provider.ts` + `providers.ts` registry
- Start (state + PKCE where supported) → server callback exchange → AES-GCM encrypted tokens in `.data/mind-connectors`
- Status honest: `not_configured` / `not_connected` / `connected` (never fake Connected)
- Disconnect + revoke where supported (Google form revoke, Slack auth.revoke, GitHub DELETE applications token)
- Drive: `resolveGoogleDriveAccessToken` + `google_drive.json` record for media connection-status contract

### Routes
- `/api/mind/oauth/$connector/{start,callback,status,disconnect}` for dynamic connectors
- Notion routes unchanged under `/api/mind/oauth/notion/*`

### Commits
- `b64b7cf` Generalize connector OAuth into a shared provider abstraction.
- `10337ba` Add dynamic OAuth start/callback/status/disconnect routes per connector.
- `dabf74f` Wire ServiceBoard Connect and Disconnect for Google, Slack, and GitHub.
- `2ecc791` Add unit tests and mock e2e for OAuth providers beyond Notion.
- `a5d46b2` Document Google, Slack, and GitHub OAuth env var names in .env.example.

### Checks
- typecheck: pass
- mind/src tests: 246 pass (incl. 20 OAuth unit tests)
- build: pass
- e2e mock: PASS → `/workspace/audit/mcp-integration/oauth-beyond-notion-e2e.log`
- live: UNVERIFIED (GOOGLE_/SLACK_/GITHUB_OAUTH_CLIENT_ID absent)

### Env needed for live connect
- `CONNECTOR_TOKEN_SECRET`
- Google: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_*_REDIRECT_URI` (or `GOOGLE_OAUTH_REDIRECT_URI`)
- Slack: `SLACK_OAUTH_CLIENT_ID`, `SLACK_OAUTH_CLIENT_SECRET`, `SLACK_OAUTH_REDIRECT_URI`
- GitHub: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URI`

## 2026-11-01T14:45:02+01:00 (Africa/Lagos) — Error Banners Bot — connector status stuck fixed
- Gap: ServiceBoard cards stuck on "Checking connection…" (GitHub/Gmail/Drive/Calendar/Slack); Notion "status could not be read" on preview/integration.
- Lock: /workspace/locks/error-banners-gap-connector-status-stuck.lock — no ACTIVE exclusive claim on service-board.tsx. Did not touch connectors/ or OAuth routes.
- Cause: failed/hung status fetches left oauth null; boardState(null) kept "Checking connection…" forever; no client timeout.
- MCP 02b2703 already covered honest terminal copy for 401/403/5xx/network + boardForOauth undefined=checking.
- This lane added: AbortSignal.timeout(10_000), explicit text→JSON non-JSON handling, in-flight Retry guard, Status unavailable chip + red card Retry, service-board-status.ts + 11 regression tests.
- Commit on error-banners: eae5297 (from 58f8894). Not pushed.
- Checks: typecheck pass; TS 333/333; scripts 198/202 (4 pre-existing .grok/skills/og); lint 0 errors; build pass.
- Trial merge eae5297 + origin/mcp-integration: service-board kept as our superset; typecheck pass; TS 371 (1 MCP stdio timeout flake, re-run pass); build pass.
- Notion: child page https://app.notion.com/p/40bb95f33e42811a969ee5efb98eae7a under mirror 40bb95f33e42814aacf8c3281b4f528d (parent insert_content rejected on oversized page; create-pages child used).
- Lock releasing done.

## 2026-11-01T14:52:02+01:00 (Africa/Lagos) — Error Banners Bot — top-5 gap fixes
- Gaps 1–5 from audit https://app.notion.com/p/40bb95f33e4281eebd02c7304ad35223
- Lock: /workspace/locks/error-banners-gap-top5.lock
- Lock check: mcp-integration-gap-pc-shell-confirm-bypass ACTIVE exclusive on fleet-panels.tsx → skipped fleet list catch. voice/media/visual only claim non-banner command-app regions. failure-states free. Remotes: mcp still swallows list errors; logic has CHAT_TIMEOUT_REPLY/CHAT_DISCONNECT_REPLY but no classifier.
- Fixed: classifier kinds chat_timeout, network_failure, auth_required, forbidden_cross_site, rate_limited; command-app mcpList/mcpRegistryList reportFailure+Retry+View log; deliver uses classified audit actions.
- Skipped: fleet-panels.tsx MCP list .catch→[] (ACTIVE MCP pc-shell-confirm-bypass lock).
- Commit on error-banners: add2c08 (from f481e58). Not pushed.
- Checks: typecheck pass; TS 344/344; scripts 198/202 (4 pre-existing .grok/skills/og); lint 0 errors/5 warnings; build pass.
- Trial merge add2c08 + origin/preview/integration@2c1eb0f → resolved conflicts (command-app/package.json/service-board/handoff); typecheck pass; TS 454/454; build pass. Temp worktree removed.
- Notion: child page https://app.notion.com/p/40bb95f33e4281cdb275f3196d0d4e31 under mirror 40bb95f33e42814aacf8c3281b4f528d.
- Lock releasing.

## 2026-11-01T15:06:00+01:00 (Africa/Lagos) — Error Banners Bot — image-generation banner (banner 4)
- Gap: Imagine / Edit Imagine failures only called setError; no red Retry + View log banner.
- Lock: /workspace/locks/error-banners-imagine-banner.lock
- Lock check: media-integration.lock ACTIVE interrupted claims media/** + command-app clipboard paste ONLY — banner/classifier/retry wiring outside clipboard OK. imagine-hardening done/released. Did not touch media HTTP / mapImagineHttpError implementation (mirrored copy in failure-states only).
- Built: HonestFailureKind image_generation_failed; mapImagineHttpErrorCopy + imageGenerationFailure + imagineRetryParams; command-app runImagine/runImagineEdit → reportFailure with identical prompt/n/imageDataUrl Retry (onceRetry) + audit View log.
- Three Retry bugs: already in 18809f7 + 58f8894; retry-fidelity tests still pass.
- Commit on error-banners: 62a191e (from cb44e0c). Pushed.
- Checks: typecheck pass; TS 353/353; lint 0 errors/5 warnings; build pass. Scripts 4 pre-existing .grok/skills/og failures not re-run under memory pressure.
- Live check: INCOMPLETE — stopped. Temp WT /workspace/eb-imagine-live :8191 (~1.5GB) killed + removed per parent memory steering. Playwright chromium timed out/crashed. Evidence: /workspace/audit/error-banners-imagine-20261101T150039+01:00/. Reuse shared integration preview after Merge Gate c19.
- Remote: git ls-remote origin error-banners → 62a191ecc772bb8e6af685be67d1700fc8894f4a
- Notion: child page https://app.notion.com/p/40bb95f33e4281a0b648e8639a6cedaf under mirror 40bb95f33e42814aacf8c3281b4f528d
- Lock releasing done.
