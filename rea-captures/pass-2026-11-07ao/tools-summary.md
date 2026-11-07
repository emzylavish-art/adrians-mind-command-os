# Tools summary — pass 2026-11-07ao
Worktree: `/workspace/rea-features-wt` (branch `rea-features`)
BlackEye EXCLUDED. L1B3RT4S never run. Passive only vs adrians-mind.vercel.app.

## Offline help
| Command | Exit |
|---------|------|
| `python3 tools/rea/rea.py --help` | **0** |
| `python3 tools/security_review/security_review.py --help` | **0** |

## GodEye (`tools/godeye/godeye.py`)
- Command: `python3 tools/godeye/godeye.py https://adrians-mind.vercel.app --screenshot …/godeye.png --out …/godeye.json`
- **Exit: 0**
- Engine: **requests** fallback (Playwright not installed in env)
- Screenshot via GodEye: null; **chrome headless** wrote `godeye.png` (345189 bytes) separately
- Title: Adrian's Mind / status 200
- Links: `/explore` (200), `/login` (200); broken_same_origin_count: **0**
- Buttons (named sample): Search workspace, Library, Projects, Scheduled, New chat, Open Settings, Dictate into composer, Open voice mode, Start voice (Ctrl+Shift+V), …
- Note in JSON: **in-repo implementation; upstream identity still unconfirmed** (standing)
- GodEye path present on rea-features wt; **MISS on origin/main** tree

## OWASP ZAP passive (`tools/owasp_zap/zap_passive.py`)
- **Exit: 0**
- Engine: `in-repo-passive-probe` (no zap-baseline CLI / docker ZAP)
- Findings (2, medium):
  1. `missing_content_security_policy` — No CSP header
  2. `missing_permissions_policy` — No Permissions-Policy header
- Present hardening: HSTS, Referrer-Policy, X-Content-Type-Options, X-Frame-Options

## Key findings (tools lane)
- **CSP + Permissions-Policy missing** — confirmed again (standing)
- **OAuth** not re-tested inside tools (see live-probe ×6 401)
- **extensions.js** — 404 at site root and `/assets/` (standing)
- **Broken same-origin links** from GodEye HTML parse: none (sidebar 404s are client-route / button UX, not `<a href>` in SSR HTML)
- Sidebar/button surface still exposes Scheduled / Library / Projects / Search / voice controls (standing empty panels / Scheduled no worker / live-search gaps for authenticated Method A)
