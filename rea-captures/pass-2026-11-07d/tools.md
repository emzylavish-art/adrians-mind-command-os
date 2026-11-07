# Tools — pass 2026-11-07d
Product: **Adrian's Mind**. Worktree: `/workspace/rea-features-wt` (branch `rea-features`).
Captured: 2026-11-07 01:07:25 WAT (Africa/Lagos)
Target: https://adrians-mind.vercel.app

## Commands run
1. `python3 tools/godeye/godeye.py https://adrians-mind.vercel.app --requests-only --out .../godeye.json`
   - **exit 0**
   - Artifact: `godeye.json` (log empty / quiet)
2. `python3 tools/owasp_zap/zap_passive.py https://adrians-mind.vercel.app --out .../zap-passive.json`
   - **exit 0**
   - Artifact: `zap-passive.json`

## Skipped / excluded
- **BlackEye**: EXCLUDED (registry restricted; phishing/credential-collection blocked)
- **L1B3RT4S**: not run (pass rule)
- Identity-unconfirmed tools (God's Eyes upstream, Blackbox, Arrow EA): not run as upstream; in-repo GodEye CLI only
- `tools/rea/rea.py`: path-mode only (`path` arg; no `--url`) → **skipped**; note recorded
- `tools/security_review/security_review.py`: path-mode only (offline source heuristic; no URL mode) → **skipped**; note recorded

## GodEye key findings
- title: Adrian's Mind; status 200; engine requests
- link_count **2** (anchors: `/explore`, `/login`) — both 200; **broken_same_origin_count 0**
- button_count **69** (sidebar/nav mostly `<button>`, not anchors) — button vs anchor pattern **UNCHANGED**
- Named buttons include Library, Projects, Scheduled, Open Settings, New chat, voice controls — deep paths `/tools` `/voice` `/artifacts` `/settings` `/activity` `/scheduled` remain URL 404s when probed (see probes.md)
- script_count 2; form_count 2; input_count 4; screenshot null (requests-only)
- **extensions.js** still loaded: `https://grok.com/grok-app-builder/extensions.js` — **UNCHANGED**
- note: "in-repo implementation; upstream identity still unconfirmed" — **UNCHANGED**

## ZAP passive key findings
- Response 200; headers present: Referrer-Policy, HSTS (preload), XCTO nosniff, XFO DENY — **UNCHANGED** (already live)
- Findings (2):
  - `missing_content_security_policy` (medium) — **still missing CSP**
  - `missing_permissions_policy` (medium) — **still missing Permissions-Policy**
- Full ZAP daemon not installed; in-repo passive baseline used; active scan disabled

## OAuth (cross-check)
- Unsigned `/api/mind/oauth/{github,gmail,google_calendar,google_drive,notion,slack}/status` → all **401** "Sign in is required." — **UNCHANGED**

## vs 07c
- All tool exits, CSP/Permissions-Policy gap, extensions.js, button-vs-anchor, OAuth×6 401: **UNCHANGED**
