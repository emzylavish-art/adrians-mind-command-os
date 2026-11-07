# BCD summary — pass 2026-11-07ay

| ref | tip | note |
|---|---|---|
| main | b5d888d (Merge PR #23 codex/mcp-oauth-mvp) | UNCHANGED |
| preview/integration | aa53aa0 | UNCHANGED; diverged ahead 85 / behind 320 |
| whisper-flow | 5ab07d0 | UNCHANGED |
| voice-cloning-studio | 55d12ec | UNCHANGED |
| rea-features (remote) | 04e3761 | docs branch |
| prod READY | dpl_HmAxBEus6oL75hCkTuXE8NDSM9qF @ main b5d888d | UNCHANGED |
| live asset | index-ChogKXym.js | UNCHANGED |
| branches | 108 | page1=100 + page2=8 |

Open PRs (not live): #26 cursor/visual-polish-041b @ c9531fc (upd 09:40Z); #25 cursor/prod-mcp-worker-de4c @ e682b1b (upd 09:27Z); plus older #22/#12/#9/#7/#6/#2.

## Live probes
- `/` `/login` `/memory` `/explore` 200; `/dashboard` 307→login; `/tools` `/voice` `/chat` `/activity` `/voice-cloning-studio` `/whisper-flow` `/api/tools/registry` 404
- OAuth×6 `/api/mind/oauth/{github,gmail,google_calendar,google_drive,notion,slack}/status` → 401 Sign in is required (standing)
- Headers: HSTS / XCTO / XFO / Referrer-Policy present; CSP + Permissions-Policy missing (standing)

## Tools
- godeye: status 200; engine requests; 69 buttons; 0 console errors; 0 broken same-origin; screenshot null
- zap_passive: findings_count=2 (missing CSP + Permissions-Policy)
- rea.py / security_review.py: --help exit 0
- BlackEye excluded
