# GitHub + tools + live probe — REA pass 2026-11-07ap
Product: Adrian's Mind (Adrian's Mind Command OS)
Captured: 2026-11-07 ~09:10 WAT (Africa/Lagos)
Repo: emzylavish-art/adrians-mind-command-os. Read-only; no code edits, no commits.

## Branch tips vs 07ao
| Ref | 07ao | 07ap | Status |
|---|---|---|---|
| main | b5d888d | b5d888d | UNCHANGED |
| preview/integration | aa53aa0 | aa53aa0 | UNCHANGED |
| prod tip (zapia/pc-approvals-error-repair-2026-11-05, zapia-isolated-auth-20261104) | e3ccc51 | e3ccc51 | UNCHANGED |
| whisper-flow | 5ab07d0 | 5ab07d0 | UNCHANGED |
| voice-cloning-studio | 55d12ec | 55d12ec | UNCHANGED |
| rea-features (origin) | — | 66a8f8c | (local wt HEAD was bb63a37 in 07ao) |
- Branch count: 106 (page 1 = 100, page 2 = 6). No new branch names stood out compared with the 07ao list; latest-named are backup/gpt-proxy-stdio-20261106, fix/mcp-runner-tool-parity-20261106, zapia/*-20261106.
- main last commit: b5d888d Merge PR #23 codex/mcp-oauth-mvp (2026-11-07 08:46 WAT). preview/integration last commit: aa53aa0 Phase 5 MODEL_PROVIDER harness (2026-11-03).

## compare_commits
- main...preview/integration: diverged, ahead 85 / behind 320, 300 files (page cap), merge-base 714ad22 — UNCHANGED
- e3ccc51...main: diverged, main ahead 9 / behind 24, 22 files, merge-base e4ed639 — UNCHANGED (prod is still not on main; it's missing the MCP/OAuth merges #23/#24)

## Live asset
- index-qV1VC2j2.js — UNCHANGED. Headers: Vercel, x-vercel-cache MISS, HSTS preload, nosniff, X-Frame-Options DENY.

## HTTP status matrix (no auth) — all UNCHANGED vs 07ao
| Path | Status |
|---|---|
| / | 200 (41255 B) |
| /login | 200 |
| /dashboard | 307 → /login?next=%2Fdashboard |
| /memory | 200 (SPA shell, no auth redirect) |
| /explore | 200 (SPA shell, no auth redirect) |
| /tools /voice /chat /activity | 404 |
| /api/mind/oauth/{github,gmail,google_calendar,google_drive,notion,slack}/status | 401 `{"ok":false,"error":"Sign in is required."}` |

## GodEye (tools/godeye/godeye.py)
- exit 0, engine `requests`, status 200, title "Adrian's Mind", links 2 (/explore 200, /login 200), buttons 69, forms 2, inputs 4, scripts 2, styles 3, console errors 0, **broken same-origin links 0** — UNCHANGED
- Screenshot: null because the requests engine has no browser, so no godeye.png was written. 07ao's godeye.png came from another source.

## ZAP passive (tools/owasp_zap/zap_passive.py)
- exit 0, engine in-repo-passive-probe (ZAP daemon not installed; active scan disabled), 2 findings — UNCHANGED:
  - missing_content_security_policy (medium)
  - missing_permissions_policy (medium)

## Offline help
- tools/rea/rea.py --help exit 0; tools/security_review/security_review.py --help exit 0 (rea-help.txt, secrev-help.txt).
- BlackEye, L1B3RT4S, and identity-unconfirmed tools were NOT run.

## NEW anomalies vs 07ao
- None. Everything matches 07ao: repo tips, divergence counts, live bundle, HTTP matrix, GodEye and ZAP output.
- Standing items still open: prod e3ccc51 is diverged from main (24/9); Whisper Flow and Voice Cloning Studio aren't merged into main or prod; /tools /voice /chat /activity return 404; no CSP or Permissions-Policy header.
