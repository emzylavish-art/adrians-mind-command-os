# GitHub + tools + live probe — REA pass 2026-11-07aq
Product: Adrian's Mind (Adrian's Mind Command OS)
Captured: 2026-11-07 ~09:23 WAT (Africa/Lagos)
Repo: emzylavish-art/adrians-mind-command-os. Read-only; no code edits, no commits/push/merge/force.

## Branch tips vs 07ap
| Ref | 07ap | 07aq | Status |
|---|---|---|---|
| main | b5d888d | b5d888d | UNCHANGED |
| preview/integration | aa53aa0 | aa53aa0 | UNCHANGED |
| prod tip (zapia/pc-approvals-error-repair-2026-11-05, zapia-isolated-auth-20261104) | e3ccc51 | e3ccc51 | UNCHANGED |
| whisper-flow | 5ab07d0 | 5ab07d0 | UNCHANGED |
| voice-cloning-studio | 55d12ec | 55d12ec | UNCHANGED |
| rea-features (origin) | 66a8f8c | f1ed41c | NEW tip |

- rea-features NEW tip f1ed41c = `docs(rea): internal audit pass 2026-11-07ap` (2026-11-07 09:12 WAT); 1 commit ahead of 66a8f8c. Docs-only; not an app/runtime change.
- Branch count: 106 (page 1 = 100, page 2 = 6). Same zapia/* page-2 set as 07ap; no new branch names.
- main tip still b5d888d Merge PR #23 codex/mcp-oauth-mvp (2026-11-07 08:46 WAT). preview/integration tip still aa53aa0 Phase 5 MODEL_PROVIDER harness (2026-11-03).
- main tree (non-recursive): `tools/` directory present (sha 0b49006…).

## compare_commits
- main...preview/integration: diverged, ahead 85 / behind 320, merge-base 714ad22 — UNCHANGED
- e3ccc51...main: diverged, main ahead 9 / behind 24, merge-base e4ed639 — UNCHANGED (prod still not on main; missing MCP/OAuth merges #23/#24)
- Latest Production deployment (gh deployments): e3ccc51 @ 2026-11-06 05:38 WAT — UNCHANGED tip

## Live asset
- index-qV1VC2j2.js — UNCHANGED. Headers: HSTS preload, nosniff, X-Frame-Options DENY, referrer-policy strict-origin-when-cross-origin; **no CSP, no Permissions-Policy**.

## HTTP status matrix (no auth) — all UNCHANGED vs 07ap
| Path | Status |
|---|---|
| / | 200 (41255 B) |
| /login | 200 |
| /dashboard | 307 → /login?next=%2Fdashboard |
| /memory | 200 (SPA shell, no auth redirect) |
| /explore | 200 (SPA shell, no auth redirect) |
| /tools /voice /chat /activity | 404 |
| /api/mind/oauth/{github,gmail,google_calendar,google_drive,notion,slack}/status | 401×6 |

## GodEye (tools/godeye/godeye.py)
- exit 0, engine `requests`, status 200, title "Adrian's Mind", links 2, buttons 69, forms 2, inputs 4, scripts 2, styles 3, console errors 0, broken same-origin links 0 — UNCHANGED
- Screenshot: null (requests engine; no godeye.png written) — same as 07ap

## ZAP passive (tools/owasp_zap/zap_passive.py)
- exit 0, engine in-repo-passive-probe (ZAP daemon not installed; active scan disabled), 2 findings — UNCHANGED:
  - missing_content_security_policy (medium)
  - missing_permissions_policy (medium)

## Offline help
- tools/rea/rea.py --help exit 0 → rea-help.txt
- tools/security_review/security_review.py --help exit 0 → security_review-help.txt
- BlackEye, L1B3RT4S, and identity-unconfirmed tools were NOT run.

## NEW owner-actionable findings vs 07ap
- **None.** Only delta is origin/rea-features tip advancing for the prior pass's docs commit (f1ed41c). Live site, prod tip, main, preview/integration, pillar branches, OAuth 401×6, sidebar 404s, and residual CSP+Permissions-Policy are unchanged.
- Known standing list remains open (not re-flagged as NEW): XAI_API_KEY unset; 403/login preview-only; heavy-asset 404s; sidebar deep-link 404s; live-search env; chat/⌘K/Artifacts; empty panels; VCS missing; CF burner pending; GodEye upstream unconfirmed; OAuth 401×6; residual CSP+Permissions-Policy; audit example.com; forbidden_cross_site; Grok honesty; Universe hang intermittent; prod e3ccc51 diverged from main (9/24).
