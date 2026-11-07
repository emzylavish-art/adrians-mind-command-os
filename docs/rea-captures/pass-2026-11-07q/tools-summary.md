# REA pass 2026-11-07q — tools summary

Product: **Adrian's Mind**. Worktree `/workspace/rea-features-wt` @ `db3cec0` (`rea-features`). Read-only. BlackEye excluded. L1B3RT4S not run.

## Commands run
- `python3 tools/godeye/godeye.py https://adrians-mind.vercel.app --screenshot …/godeye.png --out …/godeye.json` → **exit 0**
- `python3 tools/owasp_zap/zap_passive.py https://adrians-mind.vercel.app --out …/zap-passive.json` → **exit 0**
- `python3 tools/rea/rea.py --help` → offline path scanner only (no URL mode)
- `python3 tools/security_review/security_review.py --help` → offline static review only

## GodEye (live)
- Engine: requests fallback (summary.engine=`requests`); product title Adrian's Mind; status 200
- buttons=69; forms=2; inputs=4; scripts=2; styles=3; broken_same_origin_count=0
- Live asset still `index-qV1VC2j2.js`; third-party `https://grok.com/grok-app-builder/extensions.js` still present (known)
- GodEye upstream identity: **unconfirmed** (known; not re-routed)

## ZAP passive (in-repo probe)
- Present: Referrer-Policy, HSTS, X-Content-Type-Options, X-Frame-Options
- **Still missing:** Content-Security-Policy, Permissions-Policy (known; not re-routed)

## Live HTTP probes (curl)
| Path | Code |
|------|------|
| `/` `/login` `/memory` `/explore` | 200 |
| `/dashboard` | 307 → `/login?next=%2Fdashboard` |
| `/tools` `/voice` `/artifacts` `/settings` `/activity` `/scheduled` `/library` `/projects` | 404 |
| `/api/mind/oauth/{github,gmail,google_calendar,google_drive,notion,slack}/status` | **401** ×6 (known)

## NEW from tools this pass
**None.** Same residual CSP/Permissions-Policy, OAuth×6 401, extensions.js, deep-link 404s as 07p.
