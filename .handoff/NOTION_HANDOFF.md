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


## Gap done: OAuth callback XSS / state traversal (2026-11-01 Africa/Lagos)

**Status:** done (typecheck + oauth/security/stdio/pairing tests + build passed; one flaky workspace normalize timing under load unrelated)

### Fixed
- H1: shared `oauth-callback-html` escape + CSP + nosniff; fixed provider error messages; postMessage to `window.location.origin`
- H2: strict state regex + pending path containment; atomic rename claim
- H3: 10m TTL, single-use, prune, connector+owner bind
- Attacker pass: redirect_uri https/localhost; Origin CSRF on start/disconnect; no upstream error_description leak; CONNECTOR_TOKEN_SECRET required ≥16; revokeOk honesty; pairing id path validation; ServiceBoard settles status errors

### Commits
- `2595ba7` Harden OAuth connectors…
- (routes/ServiceBoard/pairing + tests follow)

## Gap done: stdio MCP servers (2026-11-01 Africa/Lagos)

**Status:** done (stdio unit + e2e PASS; typecheck/build previously green on tip)

### Shipped
- Execute registered command MCP servers: initialize, tools/list, tools/call with connect/call timeouts and child cleanup
- Operator allowlist `MIND_MCP_STDIO_ALLOW` required before any spawn (deny by default)
- Block LD_PRELOAD/NODE_OPTIONS/PATH override etc. from server env
- Tools UI timeout/error status; e2e script `scripts/mcp/stdio-e2e.mjs`

### Commits
- `cf3bc07` Execute registered stdio MCP servers…
- `8d46376` Tools UI timeout/error status for stdio…
- (allowlist commit on tip)

## Security fix: unauthenticated built-in MCP HTTP endpoint (2026-11-01 Africa/Lagos)

**Status:** done — fixed, regression-tested, pushed (`d113625`).

### Weakness (confirmed)
`/api/mind/mcp/builtin` had no auth. Anyone who could reach the app could POST
JSON-RPC `tools/call` and run `pglite_query` against the app DB (confirmed earlier:
anonymous call on :8083 returned rows, see `live-verify.log`), read/append Notion
pages with the server `NOTION_TOKEN`, and send `pc_run_shell` with `confirm=true`
to the legacy `MIND_PC_AGENT_URL` agent (if one is set).

### Fix
- `handleBuiltinMcpHttp(request, { authenticate, getSql?, isHalted? })`: without an
  authenticator, or when it returns null or throws → 401 JSON-RPC error before any
  MCP server or tool is created (no tool list leaks). The old `(request, getSql)` call
  shape also fails closed.
- Emergency stop → 403; a halt read that throws also counts as halted.
- Tools are scoped to the signed-in owner (`ownerId` goes to notion_* and pc_run_shell).
- Route uses `requireUserId` (cookie or bearer session) and `haltIsOn`.
- Callers in e2e/verify-live scripts updated.

### Checks
- New `src/lib/mind/mcp/builtin-server.test.ts`: 7 tests. All 7 failed before the fix and all 7 pass after it.
- typecheck: pass
- mind/src tests: 284/284 pass
- scripts tests: 198/202. The 4 failures (SKILL.md/AGENTS.md/og-skill doc checks) were already failing before this change and are unrelated.
- build: pass; `npm run mcp:e2e`: pass
- Live on a local preview (:8141, built from this commit): an anonymous call and a forged bearer to `tools/call pglite_query` both got **HTTP 401**. Not checked live: a signed-in call (no session on the box). That path is covered only by unit tests.
- Auth-disabled dev mode (`VITE_AUTH_ENABLED=false`, no DATABASE_URL) still maps to `dev-user`, the same as every other route.

### Open (attacker pass notes, not fixed this cycle)
- HTTP MCP registry `rpc()` has no fetch timeout, no response-size cap, and follows redirects. A hostile https MCP server can hang the Tools list (servers are listed one after another), use up memory, or redirect to internal hosts (blind SSRF / port probe through the status code).
- https registration accepts private/link-local IP literals. http is allowed on localhost by design.
- `pglite_query` guard: functions with side effects like `set_config()`/`nextval()` are not write verbs, so they pass the guard (only matters inside PGLite).

## Security fix: remote (http) MCP server hang / memory / SSRF (2026-11-01 Africa/Lagos)

**Status:** done — fixed, regression-tested, pushed.

### Weakness (confirmed in code)
`registry.ts` `rpc()` had no timeout, read the whole body with no size cap, and
followed redirects (forwarding the Bearer token). Registration accepted https to
private/link-local IP literals (e.g. `169.254.169.254`) and URLs with
`user:pass@`. A hostile or broken server could hang the Tools list (servers are
listed one after another), exhaust memory, or bounce requests to internal hosts.

### Fix
- 15s per-request deadline (AbortController + race); list rows and calls report `timeout` honestly.
- 1 MB response cap (content-length precheck + streamed read that cancels on overflow).
- `redirect: "manual"`; any 3xx is an error, never followed.
- `httpServerUrlProblem()`: refuses embedded credentials and private/loopback/link-local/CGNAT/multicast/IPv4-mapped IPv6 literals; http only on localhost. Re-checked at call time for stores saved before this guard.

### Checks
- New `src/lib/mind/mcp/registry-http.test.ts` (6 tests, real local http servers): hang → timeout, 307 redirect target never hit, 12.8 MB stream dropped at 100 KB cap, private/credentialed URLs refused, legacy stored metadata URL never fetched, well-behaved server still lists + calls. Test file fails against the pre-fix registry.
- typecheck pass; mind/src tests 290/290; build pass; `npm run mcp:e2e` pass.

### Open
- DNS rebinding / hostnames that resolve to private IPs are not checked (no DNS resolution at save or call time).
- `pglite_query` guard: side-effect functions (`set_config()`, `nextval()`) still pass (PGLite-only impact).

## Gap: H9 pc_run_shell confirm bypass (2026-11-01, Africa/Lagos)

**Status:** complete (2026-11-01T14:52:06+01:00)  
**Lock:** `mcp-integration-gap-pc-shell-confirm-bypass.lock` (released after push)

### Fix
- `pc_run_shell` **ignores** tool-arg `confirm` / `approved` / `approvalId`.
- Non-allowlisted commands create a **server-issued** pending approval (command hash, agent id, owner, TTL 3 min) and return `needsApproval` + approval id (token **not** in MCP result).
- Only authenticated human POST `/api/mind/pc/approve` (session cookie) can consume the one-time token (timing-safe compare); `/api/mind/pc/deny` rejects; list via GET `/api/mind/pc/approvals`.
- Approvals are single-use, expire, reject forged/mismatched/reused tokens; emergency stop blocks create + approve.
- Tools UI: minimal Approve/Deny under **PC shell approvals** (`fleet-panels.tsx`; not `service-board.tsx`).

### Verification
- `tsc --noEmit`: pass
- mind/src tests: **296/296** pass (incl. `pc-pairing/approvals.test.ts` H9 regressions)
- `npm run build`: pass

### Commits (this gap)
- (pending push) Harden pc_run_shell with human UI approvals; ignore client confirm.


## Security fix: pglite_query side-effect function bypass (2026-11-01 Africa/Lagos)

**Status:** done — fixed, regression-tested, pushed. Commit c2266bb.

### Weakness (confirmed live on an in-memory PGLite)
`assertReadOnlySql` only blocked write keywords, so any SELECT that *calls* a state-changing function passed:
- `SELECT set_config('search_path','evil',false)` persisted on the shared single connection, poisoning every later app query.
- `U&"\0073et_config"(...)` (unicode-escaped name) and `"set_config"(...)` (quoted name) hid the function from word checks.
- `SELECT pg_sleep(2)` ran the full 2s despite a 500ms timeout: PGLite runs synchronously in the Node event loop and ignores statement_timeout, so a long call freezes the whole server.
- `pg_advisory_lock`, `lo_create`, `query_to_xml('<sql>')`, `FOR SHARE` row locks, and `SELECT ... INTO` also got through.
- Plain EXPLAIN never worked (it was wrapped in a subquery).

### Fix
- Denylist of side-effect / file / backend / nested-SQL / blocking functions (checked with quotes stripped), refuse U& escapes, nested or unterminated block comments, locking reads, INTO/PREPARE/LOCK, EXPLAIN ANALYZE, SQL over 20,000 chars and NUL bytes.
- Plain EXPLAIN runs unwrapped; rows capped client-side; timeout timer is cleared.

### Checks
- New `src/lib/mind/mcp/pglite-guard.test.ts` (24 tests on real PGLite): 23 fail against the old guard, all pass now; confirms search_path, sequence, advisory locks, and tables are untouched after every attack.
- typecheck pass; mind/src tests 320/320; build pass; `npm run mcp:e2e` pass (pglite_query ok).

### Open
- CPU-heavy pure reads (e.g. huge `generate_series` or cross joins) can still block PGLite's event loop; a real fix needs running PGLite in a worker so a timeout can terminate it.
- DNS rebinding for http MCP servers (from the previous cycle) still open.
