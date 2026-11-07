# REA pass 2026-11-07j — tools summary (Methods B/C)

Product: **Adrian's Mind** / Adrian's Mind Command OS (never Edurain).  
Target: https://adrians-mind.vercel.app only. BlackEye excluded. L1B3RT4S not run. identity-unconfirmed never run.  
Read-only; no app code edits, commits, Notion writes, SendToAgent, or lock release.  
Worktree: `/workspace/rea-features-wt` on `rea-features` @ `f1de049` (local tip; shallow clone). Lock held by parent.

## Exit codes

| Tool | Command | Exit |
|------|---------|------|
| GodEye | `python3 tools/godeye/godeye.py … --requests-only --out …/godeye.json` | **0** |
| ZAP passive | `python3 tools/owasp_zap/zap_passive.py … --out …/zap-passive.json` | **0** |
| curl live probes + asset extract | routes + OAuth×6 + HTML | **0** |
| gh compare `main...preview/integration` | jq status/ahead/behind | **0** |
| gh deployments Production | per_page=5 | **0** |
| user-GitHub-xai `list_branches` / `list_commits` | MCP | **0** |

Skipped: `rea.py` / `security_review` (no URL mode per brief).

## GodEye (`godeye.json`)

- Mode: requests-only (engine=requests); status **200**; title **Adrian's Mind**
- **button_count: 69**; **link/anchor_count: 2** (`/explore`, `/login`; both same-origin 200)
- form_count: 2; input_count: 4; script_count: 2; style_count: 3
- console_error_count: 0; broken_same_origin_count: 0; screenshot: null
- Scripts: `/assets/index-qV1VC2j2.js`, `https://grok.com/grok-app-builder/extensions.js`
- Note: in-repo implementation; upstream identity still unconfirmed
- vs 07i: **UNCHANGED** counts/asset

## ZAP passive (`zap-passive.json`)

- Engine: in-repo-passive-probe; status **200**; findings_count: **2**
- **Headers present:** HSTS; x-content-type-options nosniff; x-frame-options DENY; referrer-policy strict-origin-when-cross-origin
- **Headers missing:** Content-Security-Policy (`missing_content_security_policy`, medium); Permissions-Policy (`missing_permissions_policy`, medium)
- vs 07i: **UNCHANGED**

## Live probes highlight

| Path / check | Result | vs 07i |
|--------------|--------|--------|
| `/` `/login` `/memory` `/explore` | 200 | UNCHANGED |
| `/dashboard` | 307 → `/login?next=%2Fdashboard` | UNCHANGED |
| `/tools` `/voice` `/artifacts` `/settings` `/activity` `/scheduled` | 404 | UNCHANGED |
| OAuth status ×6 | all 401 | UNCHANGED |
| Live JS | `index-qV1VC2j2.js` | UNCHANGED |

## Artifacts

- `/workspace/rea-captures/pass-2026-11-07j/godeye.json`
- `/workspace/rea-captures/pass-2026-11-07j/zap-passive.json`
- `/workspace/rea-captures/pass-2026-11-07j/live-probes.txt`
- `/workspace/rea-captures/pass-2026-11-07j/assets-extract.txt`
- `/workspace/rea-captures/pass-2026-11-07j/headers-home.txt`
- `/workspace/rea-captures/pass-2026-11-07j/home.html`
- `/workspace/rea-captures/pass-2026-11-07j/github-blueprint.md`
- `/workspace/rea-captures/pass-2026-11-07j/tools-summary.md`
