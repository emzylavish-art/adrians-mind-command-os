# GitHub + tools + live probe — REA pass 2026-11-07as
Product: Adrian's Mind (Adrian's Mind Command OS)
Captured: 2026-11-07 ~09:42 WAT (Africa/Lagos)
Repo: emzylavish-art/adrians-mind-command-os. Read-only; no code edits, no commits/push/merge/force.
Compared to prior pass: 2026-11-07ar.

## Branch tips vs 07ar
| Ref | 07ar | 07as | Status |
|---|---|---|---|
| main | b5d888d | b5d888d | UNCHANGED |
| preview/integration | aa53aa0 | aa53aa0 | UNCHANGED |
| prod tip (Production deploy; zapia/pc-approvals-error-repair-2026-11-05 / zapia-isolated-auth-20261104) | e3ccc51 | e3ccc51 | UNCHANGED |
| whisper-flow | 5ab07d0 | 5ab07d0 | UNCHANGED |
| voice-cloning-studio | 55d12ec | 55d12ec | UNCHANGED |
| rea-features (origin) | b4830c9 | 1377d1c | NEW tip (docs-only) |

- rea-features NEW tip `1377d1c` = `docs(rea): internal audit pass 2026-11-07ar` (2026-11-07 09:35 WAT / 02:35 CST). Docs-only; not an app/runtime change.
- Branch count: **108** (was 107 in 07ar). **Added branch name:** `cursor/visual-polish-041b` tip `c9531fc` — "Polish composer layout, empty states, and search keyboard focus." (2026-11-07 09:38 WAT). Inventory delta only; not on main/prod; not a live gap by itself.
- No branches removed vs 07ar.
- main tip still b5d888d Merge PR #23 codex/mcp-oauth-mvp (2026-11-07 08:46 WAT). Recent main also includes a19adbb Merge PR #24 cursor/worker-mcp-tools-de4c.
- preview/integration tip still aa53aa0 Phase 5 MODEL_PROVIDER harness (2026-11-03).

### Recent commits (short)
main (last 8): b5d888d, a19adbb, fcab42b, 30843aa, 267dc39, 34e0e8b, 392eb14, 46d2d24
preview/integration (last 8): aa53aa0, c1ee830, b84dcc2, 23860f7, 518db93, bba4e84, 4af6cc9, c947fe9

### get_commit pillar tips
- whisper-flow `5ab07d0` — test(whisper-flow): wait for hydration after integration drawer UI (2026-11-03) — UNCHANGED
- voice-cloning-studio `55d12ec` — visual(vcs): polish engine-down empty card + error alert cards (2026-11-03) — UNCHANGED

### get_git_tree (main, recursive=false) — high-level dirs
Trees: `.devcontainer`, `.github`, `.handoff`, `agent`, `docs`, `mcp`, `migrations`, `policies`, `public`, `scripts`, `server`, `src`, `team`, `tools`, `upstream`, `workers`
Notable files: AGENTS.md, ENGINEERING.md, README.md, RUN.md, package.json, vercel.json, vite.config.ts, Dockerfile.mcp, .env.example

## compare_commits
- main...preview/integration: diverged, ahead **85** / behind **320**, merge-base `714ad22` — UNCHANGED
- e3ccc51...main: diverged, main ahead **9** / behind **24**, merge-base `e4ed639` — UNCHANGED (prod still not on main; missing MCP/OAuth merges #23/#24)
- main...e3ccc51: diverged, prod ahead **24** / behind **9**, merge-base `e4ed639` — UNCHANGED (symmetric of above)

## Live asset
- `index-qV1VC2j2.js` — **UNCHANGED** (homepage 41255 B). Title: Adrian's Mind.
- Headers: HSTS preload, nosniff, X-Frame-Options DENY, referrer-policy strict-origin-when-cross-origin; **no CSP, no Permissions-Policy**.

## HTTP status matrix (no auth) — all UNCHANGED vs 07ar
| Path | Status |
|---|---|
| / | 200 (41255 B) |
| /login | 200 |
| /dashboard | 307 → /login?next=%2Fdashboard |
| /memory | 200 (SPA shell, no auth redirect) |
| /explore | 200 (SPA shell, no auth redirect) |
| /tools /voice /chat /activity | 404 |
| /api/mind/oauth/{github,gmail,google_calendar,google_drive,notion,slack}/status | 401×6 |

## Audit secret
- `/home/box/.secrets/rea-audit-login.env`: domain still **example.com** (password not printed; login not attempted). Known since 06d.

## GodEye (tools/godeye/godeye.py)
- Command: `python3 tools/godeye/godeye.py https://adrians-mind.vercel.app --out .../godeye.json`
- exit **0**, engine `requests`, status 200, title "Adrian's Mind", links 2, buttons 69, forms 2, inputs 4, scripts 2, styles 3, console errors 0, broken same-origin links 0 — **UNCHANGED** vs 07ar
- Screenshot: null / no godeye.png written (requests engine; Playwright absent) — same as 07ar
- GodEye upstream identity unconfirmed; GodEye CLI on `rea-features` worktree only
- BlackEye EXCLUDED; L1B3RT4S not run
- note: "in-repo implementation; upstream identity still unconfirmed"

## ZAP passive (tools/owasp_zap/zap_passive.py)
- exit **0**, engine in-repo-passive-probe (ZAP daemon not installed; active scan disabled), findings_count=**2** — UNCHANGED:
  - missing_content_security_policy (medium)
  - missing_permissions_policy (medium)
- Present: XCTO / XFO / Referrer-Policy / HSTS

## Offline help
- `tools/rea/rea.py --help` exit 0 → rea-help.txt
- `tools/security_review/security_review.py --help` exit 0 → security_review-help.txt

## Blueprint pillars (evidence this pass)
| Pillar | State | Evidence |
|---|---|---|
| Whisper Flow | branch-only | tip `5ab07d0` UNCHANGED; not on main/prod; no live whisper surface beyond generic voice chrome buttons in GodEye DOM |
| Voice Cloning Studio | branch-only | tip `55d12ec` UNCHANGED; live `/voice` **404** |
| Tool Registry (GodEye only; BlackEye excluded) | partial | in-repo GodEye CLI works (exit 0); upstream unconfirmed; live `/tools` **404** |
| Continuous evolution | partial | main still `b5d888d`; Production still `e3ccc51` (9 ahead / 24 behind main); live asset still `index-qV1VC2j2.js`; rea-features docs-only tip advance; new branch `cursor/visual-polish-041b` (not merged) |

## NEW owner-actionable findings vs 07ar
- **None.** Deltas are: (1) origin/rea-features docs tip `1377d1c` (docs for 07ar); (2) branch inventory +1 name `cursor/visual-polish-041b` @ `c9531fc` (composer/empty-states/search polish; not on main/prod; not a new live gap).
- Live site, prod tip, main, preview/integration, pillar branches, OAuth 401×6, sidebar/deep-link 404s, residual CSP+Permissions-Policy, audit example.com — all unchanged.
- Already-known (not re-raised as NEW): XAI_API_KEY, 403/login preview-only, OAuth 401×6, CSP+Permissions-Policy, sidebar buttons, deep-link 404s, extensions.js, VCS missing, live-search, chat/⌘K/Artifacts, empty panels, CF burner, GodEye unconfirmed, audit example.com, forbidden_cross_site, explore TEMPLATE, Universe hang intermittent, Grok honesty mismatch, Scheduled no-worker.

## Artifacts written
- `/workspace/rea-captures/pass-2026-11-07as/` — github-tools.md, godeye.json, zap-passive.json, homepage.html, curl-probes.txt, rea-help.txt, security_review-help.txt, branches.txt (108 names)
- No godeye.png (requests engine)
