# REA pass 2026-11-07n — tools summary

Product: **Adrian's Mind** / Adrian's Mind Command OS (never Edurain).  
Target: https://adrians-mind.vercel.app only. BlackEye excluded. L1B3RT4S not run.  
Read-only; no app code edits. Worktree: `/workspace/rea-features-wt` on `rea-features` @ `0715d6b`.  
Compared to pass **2026-11-07m**.

## Exit codes

| Tool | Command | Exit |
|------|---------|------|
| GodEye | `python3 tools/godeye/godeye.py … --requests-only --out …/godeye.json` | **0** |
| ZAP passive | `python3 tools/owasp_zap/zap_passive.py … --out …/zap-passive.json` | **0** |
| curl live probes + headers + bundle | routes + OAuth×6 + HTML | **0** |
| gh branches/commits/compare/deployments | GitHub tip map | **0** |

Skipped: `rea.py` / `security_review.py` (no URL mode — noted). BlackEye excluded. Identity-unconfirmed / L1B3RT4S skipped.

## GodEye (`godeye.json`)

- Mode: requests-only (engine=requests); status **200**; title **Adrian's Mind**
- **button_count: 69**; **link_count: 2** (`/explore`, `/login`; both same-origin 200)
- form_count: 2; input_count: 4; script_count: 2; style_count: 3
- console_error_count: 0; broken_same_origin_count: **0**; screenshot: null
- Scripts: `https://grok.com/grok-app-builder/extensions.js`, `/assets/index-qV1VC2j2.js`
- Note: in-repo implementation; upstream identity still unconfirmed
- vs 07m: **UNCHANGED** counts / asset / scripts / broken=0

## ZAP passive (`zap-passive.json`)

- Engine: in-repo-passive-probe; status **200**; findings_count: **2**
- **Headers present:** HSTS (`max-age=63072000; includeSubDomains; preload`); `x-content-type-options: nosniff`; `x-frame-options: DENY`; `referrer-policy: strict-origin-when-cross-origin`
- **Headers missing:** Content-Security-Policy (`missing_content_security_policy`, medium); Permissions-Policy (`missing_permissions_policy`, medium)
- vs 07m: **UNCHANGED** residual CSP + Permissions-Policy gaps

## Live probes / OAuth / header deltas vs 07m

| Check | 07n | vs 07m |
|-------|-----|--------|
| `/` `/login` `/memory` `/explore` | 200 | UNCHANGED |
| `/dashboard` | 307 → `/login?next=%2Fdashboard` | UNCHANGED |
| `/tools` `/voice` `/artifacts` `/settings` `/activity` `/scheduled` `/library` `/projects` | 404 | UNCHANGED |
| OAuth status ×6 (github/gmail/google_calendar/google_drive/notion/slack) | all **401** | UNCHANGED |
| Live JS | `index-qV1VC2j2.js` | UNCHANGED |
| extensions.js | still loaded from grok.com | UNCHANGED |
| CSP / Permissions-Policy | still missing | UNCHANGED |

## Artifacts

- `/workspace/rea-captures/pass-2026-11-07n/godeye.json`
- `/workspace/rea-captures/pass-2026-11-07n/zap-passive.json`
- `/workspace/rea-captures/pass-2026-11-07n/live-probes.txt`
- `/workspace/rea-captures/pass-2026-11-07n/github-blueprint.md`
- `/workspace/rea-captures/pass-2026-11-07n/tools-summary.md`
- `/workspace/rea-captures/pass-2026-11-07n/blueprint-pillars.md`
