# REA pass 2026-11-07l — tools summary

Product: **Adrian's Mind** / Adrian's Mind Command OS (never Edurain).  
Target: https://adrians-mind.vercel.app only. BlackEye excluded. L1B3RT4S not run.  
Read-only; no app code edits. Worktree: `/workspace/rea-features-wt` on `rea-features` @ `2c0d7cf`.  
Compared to pass **2026-11-07k**.

## Exit codes

| Tool | Command | Exit |
|------|---------|------|
| GodEye | `python3 tools/godeye/godeye.py … --requests-only --out …/godeye.json` | **0** |
| ZAP passive | `python3 tools/owasp_zap/zap_passive.py … --out …/zap-passive.json` | **0** |
| curl live probes + headers + bundle | routes + OAuth×6 + HTML | **0** |
| cursor-github MCP + gh deployments | branches/commits/compare | **0** |

Skipped: `rea.py` / `security_review` (no URL mode). BlackEye excluded.

## GodEye (`godeye.json`)

- Mode: requests-only (engine=requests); status **200**; title **Adrian's Mind**
- **button_count: 69**; **link_count: 2** (`/explore`, `/login`; both same-origin 200)
- form_count: 2; input_count: 4; script_count: 2; style_count: 3
- console_error_count: 0; broken_same_origin_count: **0**; screenshot: null
- Scripts: `https://grok.com/grok-app-builder/extensions.js`, `/assets/index-qV1VC2j2.js`
- Note: in-repo implementation; upstream identity still unconfirmed
- vs 07k: **UNCHANGED** counts / asset / scripts / broken=0

## ZAP passive (`zap-passive.json`)

- Engine: in-repo-passive-probe; status **200**; findings_count: **2**
- **Headers present:** HSTS (`max-age=63072000; includeSubDomains; preload`); `x-content-type-options: nosniff`; `x-frame-options: DENY`; `referrer-policy: strict-origin-when-cross-origin`
- **Headers missing:** Content-Security-Policy (`missing_content_security_policy`, medium); Permissions-Policy (`missing_permissions_policy`, medium)
- vs 07k: **UNCHANGED** residual CSP + Permissions-Policy gaps

## Live probes / OAuth / header deltas vs 07k

| Check | 07l | vs 07k |
|-------|-----|--------|
| `/` `/login` `/memory` `/explore` | 200 | UNCHANGED |
| `/dashboard` | 307 → `/login?next=%2Fdashboard` | UNCHANGED |
| `/tools` `/voice` `/artifacts` `/settings` `/activity` `/scheduled` `/library` `/projects` | 404 | UNCHANGED (library/projects also 404; known deep-link class) |
| OAuth status ×6 (github/gmail/google_calendar/google_drive/notion/slack) | all **401** | UNCHANGED |
| Live JS | `index-qV1VC2j2.js` | UNCHANGED |
| extensions.js | still loaded from grok.com | UNCHANGED |
| CSP / Permissions-Policy | still missing | UNCHANGED |

## Artifacts

- `/workspace/rea-captures/pass-2026-11-07l/godeye.json`
- `/workspace/rea-captures/pass-2026-11-07l/zap-passive.json`
- `/workspace/rea-captures/pass-2026-11-07l/live-probes.txt`
- `/workspace/rea-captures/pass-2026-11-07l/github-blueprint.md`
- `/workspace/rea-captures/pass-2026-11-07l/tools-summary.md`
- `/workspace/rea-captures/pass-2026-11-07l/blueprint-pillars.md`
