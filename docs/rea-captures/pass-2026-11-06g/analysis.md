# Pass 2026-11-06g analysis (Africa/Lagos / America/Chicago)

Methods B+C+D (GitHub + live HTTP + repo tools + pillars). Read-only. No app code edits. No BlackEye / L1B3RT4S. Captured Fri Nov 6, 2026 ~4:55 PM CST (Fri Nov 6, 2026 ~11:55 PM WAT).

## What CHANGED vs 06f

| Item | 06f → 06g | Live impact |
|---|---|---|
| `origin/main` | `e4ed639` → `e4ed639` | none |
| `preview/integration` | `aa53aa0` → `aa53aa0` | none (still 85 ahead / 311 behind) |
| Production tip `e3ccc51` | main+24 → main+24 | none |
| Live bundle | `index-qV1VC2j2.js` | **UNCHANGED** |
| extensions.js | still loaded | none |
| ZAP findings | CSP + Permissions-Policy missing | identical |
| GodEye counts | 69 buttons / 0 broken anchors | identical |
| Route/OAuth probes | match 06f table | none |
| `rea-features` tip | `327dab3` → `4d9fd52` | **noise only** (not live) |
| Audit email domain | example.com | **still placeholder** |

**No live SHA move, no HTTP status change, no header change, no bundle change.**

## NEW findings needing a fix

*(empty — none)*

Do not re-report unchanged known items as new.

## Standing known list status

| Known item | 06g status |
|---|---|
| XAI_API_KEY unset in production | unchanged (no prod tip move) |
| 403 + /login fixes on preview/integration only | unchanged (`aa53aa0` not promoted) |
| heavy-asset 404s fixed on a branch | unchanged (not newly live) |
| 11 sidebar deep-link 404s | unchanged (`/voice` `/tools` `/artifacts` `/settings` `/imagine` `/bots` + extras still 404) |
| live-search env; chat layout/⌘K/Artifacts; empty panels | unchanged |
| Voice Cloning Studio missing on live | unchanged (branch-only `55d12ec`) |
| Cloudflare burner pending | unchanged (no new evidence) |
| GodEye upstream identity unconfirmed | unchanged (registry + tool note) |
| Audit REA_AUDIT_EMAIL example.com placeholder | unchanged (still example.com) |
| CSP + Permissions-Policy residual | unchanged (ZAP×2) |
| OAuth×6 401 | unchanged |
| sidebar buttons not anchors | unchanged (0 broken same-origin anchors; 69 buttons) |
| extensions.js | unchanged |
| forbidden_cross_site Activity | unchanged (not newly fixed on live) |
| explore persona handoff unverified | unchanged |

## Verified fixed AND live?

**No.** Live asset hash and HTTP statuses match 06f.

## Artifacts

`/workspace/rea-captures/pass-2026-11-06g/` — `analysis.md`, `github.md`, `live-probes.md`, `tools.md`, `pillars.md`, `godeye.json`, `godeye.png`, `zap-passive.json`, `curl-probes-raw.txt`, `headers-root.txt`, `oauth-status.json`, `index.html`, `chrome-screenshot.log`.
