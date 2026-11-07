# REA pass 2026-11-07k — tools summary (Methods B/C)

Product: **Adrian's Mind** / Adrian's Mind Command OS (never Edurain).  
Target: https://adrians-mind.vercel.app only. BlackEye excluded. L1B3RT4S not run. identity-unconfirmed never run.  
Read-only; no app code edits. Worktree: `/workspace/rea-features-wt` on `rea-features` @ `a56ebbc`.  
Compared to pass **2026-11-07j**.

## Exit codes

| Tool | Command | Exit |
|------|---------|------|
| GodEye | `python3 tools/godeye/godeye.py … --requests-only --out …/godeye.json` | **0** |
| ZAP passive | `python3 tools/owasp_zap/zap_passive.py … --out …/zap-passive.json` | **0** |
| curl live probes + bundle extract | routes + OAuth×6 + HTML | **0** |
| cursor-github MCP + gh compare/deployments | branches/commits/tree/registry | **0** |

Skipped: `rea.py` / `security_review` (no URL mode per brief). BlackEye excluded.

## GodEye (`godeye.json`)

- Mode: requests-only (engine=requests); status **200**; title **Adrian's Mind**
- **button_count: 69**; **link/anchor_count: 2** (`/explore`, `/login`; both same-origin 200)
- form_count: 2; input_count: 4; script_count: 2; style_count: 3
- console_error_count: 0; broken_same_origin_count: 0; screenshot: null
- Scripts: `https://grok.com/grok-app-builder/extensions.js`, `/assets/index-qV1VC2j2.js`
- Interesting chrome buttons (not deep routes): Scheduled, Open Settings, Switch voice mode / Open voice mode / Start voice — UI only; `/scheduled` `/settings` `/voice` still **404** via curl
- Note: in-repo implementation; upstream identity still unconfirmed
- vs 07j: **UNCHANGED** counts/asset/scripts

## ZAP passive (`zap-passive.json`)

- Engine: in-repo-passive-probe; status **200**; findings_count: **2**
- **Headers present:** HSTS; x-content-type-options nosniff; x-frame-options DENY; referrer-policy strict-origin-when-cross-origin
- **Headers missing:** Content-Security-Policy (`missing_content_security_policy`, medium); Permissions-Policy (`missing_permissions_policy`, medium)
- vs 07j: **UNCHANGED** residual CSP + Permissions-Policy gaps

## Live probes highlight

| Path / check | Result | vs 07j |
|--------------|--------|--------|
| `/` `/login` `/memory` `/explore` | 200 | UNCHANGED |
| `/dashboard` | 307 → `/login?next=%2Fdashboard` | UNCHANGED |
| `/tools` `/voice` `/artifacts` `/settings` `/activity` `/scheduled` | 404 | UNCHANGED |
| OAuth status ×6 | all 401 | UNCHANGED |
| Live JS | `index-qV1VC2j2.js` | UNCHANGED |
| extensions.js | still loaded from grok.com | UNCHANGED |

## Artifacts

- `/workspace/rea-captures/pass-2026-11-07k/godeye.json`
- `/workspace/rea-captures/pass-2026-11-07k/zap-passive.json`
- `/workspace/rea-captures/pass-2026-11-07k/live-probes.txt`
- `/workspace/rea-captures/pass-2026-11-07k/github-blueprint.md`
- `/workspace/rea-captures/pass-2026-11-07k/tools-summary.md`
- `/workspace/rea-captures/pass-2026-11-07k/blueprint-pillars.md`
