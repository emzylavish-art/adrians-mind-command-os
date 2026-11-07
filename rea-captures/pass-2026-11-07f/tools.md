# Tools — pass 2026-11-07f
Product: **Adrian's Mind**. Worktree: `/workspace/rea-features-wt` (branch `rea-features` @ `a5f969a`).
Captured: 2026-11-07 01:38:13 WAT (Africa/Lagos)
Target: https://adrians-mind.vercel.app

## Commands run
1. `.venv-tools/bin/python3 tools/godeye/godeye.py https://adrians-mind.vercel.app --requests-only --out .../godeye.json`
   - **exit 0**
   - Artifact: `godeye.json`
2. `.venv-tools/bin/python3 tools/owasp_zap/zap_passive.py https://adrians-mind.vercel.app --out .../zap-passive.json`
   - **exit 0**
   - Artifact: `zap-passive.json`

## Skipped / excluded
- **BlackEye**: EXCLUDED (registry restricted; phishing/credential-collection blocked)
- **L1B3RT4S**: not run (pass rule)
- Identity-unconfirmed upstream tools (God's Eyes upstream, Blackbox, Arrow EA): not run as upstream; in-repo GodEye CLI only
- `tools/rea/rea.py`: path-mode only (no `--url`) → **skipped**
- `tools/security_review/security_review.py`: path-mode only (no URL mode) → **skipped**

## GodEye key findings
- title: Adrian's Mind; status 200; engine **requests** (--requests-only)
- link_count **2** (anchors: `/explore`, `/login`) — both 200; **broken_same_origin_count 0**
- button_count **69** (sidebar/nav mostly `<button>`, not anchors) — button vs anchor pattern **UNCHANGED**
- Named buttons include: Close/Open menu, Collapse sidebar, Search workspace, Library, Projects, Scheduled, New chat, Open Settings, Switch voice mode, Model mode Auto, Alerts, Dictate into composer, Open voice mode, Start voice (Ctrl+Shift+V)
- Deep paths `/tools` `/voice` `/artifacts` `/settings` `/activity` `/scheduled` remain URL 404s when probed (see live-probes.md)
- script_count 2; form_count 2; input_count 4; console_errors 0; screenshot null (requests-only)
- **extensions.js** still loaded: `https://grok.com/grok-app-builder/extensions.js` — **UNCHANGED**
- note: in-repo implementation; upstream identity still unconfirmed — **UNCHANGED**

## ZAP passive key findings
- engine: in-repo-passive-probe; Response **200**
- Headers **present**: Referrer-Policy (`strict-origin-when-cross-origin`); HSTS (`max-age=63072000; includeSubDomains; preload`); XCTO `nosniff`; XFO `DENY`
- Findings (2) — **header gaps UNCHANGED**:
  - `missing_content_security_policy` (medium) — **still missing CSP**
  - `missing_permissions_policy` (medium) — **still missing Permissions-Policy**
- Full ZAP daemon not installed; in-repo passive baseline used; active scan disabled

## OAuth (cross-check)
- Unsigned `/api/mind/oauth/{github,gmail,google_calendar,google_drive,notion,slack}/status` → all **401** `{"ok":false,"error":"Sign in is required."}` — **UNCHANGED**

## Audit secret domain
- Domain only: `example.com` (standing)

## vs 07e
- Tool exits 0/0, CSP/Permissions-Policy gap, extensions.js, button-vs-anchor (69 buttons / 2 links), OAuth×6 401: **UNCHANGED**
- No NEW tool findings beyond standing list
