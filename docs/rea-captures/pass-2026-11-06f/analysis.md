# Pass 2026-11-06f analysis (Africa/Lagos / America/Chicago)

Methods B+C only (GitHub + repo tools + live HTTP). Read-only. No app code edits. No BlackEye / L1B3RT4S. Captured Fri Nov 6, 2026 ~4:42–4:43 PM CST (11:42–11:43 PM WAT).

## GitHub SHAs vs 06e

| Ref | 06e → 06f | Status |
|---|---|---|
| `origin/main` | `e4ed639` → `e4ed639` | **UNCHANGED** |
| `origin/preview/integration` | `aa53aa0` → `aa53aa0` | **UNCHANGED** (still diverged 85 ahead / 311 behind main) |
| Production tip `e3ccc51` | main+24 → main+24 | **UNCHANGED** (`zapia/pc-approvals-error-repair-2026-11-05`, `zapia-isolated-auth-20261104`) |
| Live asset | `index-qV1VC2j2.js` | **UNCHANGED** |
| Live also loads | `https://grok.com/grok-app-builder/extensions.js` | **UNCHANGED** |

Branch noise only (not live): `rea-features` tip `7322ac9` → `327dab3`. Other noted branches (`zapia/public-landing-private-workspace-20261106` `b437c78`, `zapia/settings-workspace-navigation-20261106` `40b0c1f`, `backup/gpt-proxy-stdio-20261106` `ed2a649`, `fix/mcp-runner-tool-parity-20261106` `2e1c27b`, `voice-cloning-studio` `55d12ec`) tips unchanged vs 06e. No production commit tip exposed in HTML/meta.

## Tool exits + key findings (diff vs 06e)

| Tool | Exit | Key findings vs 06e |
|---|---|---|
| GodEye | 0 | title Adrian's Mind, status 200, 2 same-origin links, **69 buttons**, 0 broken same-origin anchors. Engine **requests** this pass (playwright Python module unavailable); 06e was playwright — label text differs (aria vs visible) but counts match. Screenshot via Chrome headless fallback → `godeye.png`. Upstream identity still unconfirmed. |
| ZAP passive | 0 | **Identical** to 06e: 2 medium findings — `missing_content_security_policy`, `missing_permissions_policy`. HSTS / XCTO / XFO / Referrer present. |
| REA offline scan | 0 | `rea-scan.json` written (inventory only). |
| Curls | 0 | Probe table below; match 06e. |

## Live probe table

| Path | HTTP (follow) | Notes |
|---|---|---|
| `/` | 200 | SPA shell; bundle `index-qV1VC2j2.js` |
| `/login` | 200 | |
| `/memory` | 200 | |
| `/explore` | 200 | |
| `/dashboard` | 200 after 1 redirect | → `/login?next=%2Fdashboard` (auth gate) |
| `/voice` | 404 | sidebar deep-link |
| `/tools` | 404 | |
| `/artifacts` | 404 | |
| `/settings` | 404 | |
| `/imagine` | 404 | |
| `/bots` | 404 | |
| `/chat` | 404 | extra deep route |
| `/workspace` | 404 | |
| `/agents` | 404 | |
| `/automations` | 404 | |

### OAuth status (`/api/mind/oauth/{…}/status`)

All six return **401** `{"ok":false,"error":"Sign in is required."}` — unchanged: github, gmail, google_calendar, google_drive, notion, slack.

### Security headers on `/`

| Header | Present? | Value / note |
|---|---|---|
| Content-Security-Policy | **No** | ZAP finding (unchanged) |
| Permissions-Policy | **No** | ZAP finding (unchanged) |
| X-Content-Type-Options | Yes | `nosniff` |
| X-Frame-Options | Yes | `DENY` |
| Referrer-Policy | Yes | `strict-origin-when-cross-origin` |
| Strict-Transport-Security | Yes | `max-age=63072000; includeSubDomains; preload` |

## NEW findings vs known list

*(empty — none)*

No live SHA move, no HTTP status change vs 06e, ZAP identical, OAuth×6 still 401, bundle hash unchanged.

## CHANGED status of known items

| Known item | 06f status |
|---|---|
| XAI_API_KEY unset in production | unchanged (no prod tip move) |
| 403 + /login fixes on preview/integration only | unchanged (`aa53aa0` not promoted) |
| heavy-asset 404s fixed on a branch | unchanged (not newly live) |
| 11 sidebar deep-link 404s | unchanged (`/voice` `/tools` `/artifacts` `/settings` `/imagine` `/bots` + extras still 404) |
| live-search env unset; chat layout/⌘K/Artifacts; empty panels | unchanged |
| Voice Cloning Studio missing on live | unchanged (branch-only `55d12ec`) |
| Cloudflare burner pending | unchanged (no new evidence) |
| GodEye upstream identity unconfirmed | unchanged |
| Audit example.com placeholder | unchanged (not re-probed login this Method B+C pass) |
| Access denied /dashboard without auth | unchanged (307/redirect → login) |
| CSP + Permissions-Policy residual | unchanged (still missing; ZAP×2) |
| OAuth×6 401 | unchanged |
| sidebar buttons not anchors | unchanged (0 broken same-origin anchors; 69 buttons) |
| extensions.js | unchanged (still loaded from grok.com) |
| Production tip e3ccc51 ahead of main e4ed639 | unchanged (ahead_by 24) |
| forbidden_cross_site | unchanged (not newly fixed on live) |
| explore handoff unverified | unchanged |

## Verified fixed AND live?

**No.** Live asset hash and HTTP statuses match 06e.

## Artifacts

`/workspace/rea-captures/pass-2026-11-06f/` — `analysis.md`, `github.md`, `tools.md`, `godeye.json`, `godeye.png`, `zap-passive.json`, `curl-probes.txt`, `headers-root.txt`, `oauth-status.json`, `index.html`, `rea-scan.json`, gh JSON dumps.
