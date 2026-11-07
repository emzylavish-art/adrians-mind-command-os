# Tools summary — pass 2026-11-07ad
Worktree /workspace/rea-features-wt @ 4a9cf38. BlackEye excluded (registry status "restricted"). L1B3RT4S / identity-unconfirmed tools (Arrow EA, Blackbox) NOT run.

| Command | Exit | Output |
|---|---|---|
| godeye.py https://adrians-mind.vercel.app --screenshot … --out godeye.json | 0 | godeye.json |
| zap_passive.py https://adrians-mind.vercel.app --out zap-passive.json | 0 | zap-passive.json |
| rea.py --help | 0 | rea-help.txt |
| security_review.py --help | 0 | secrev-help.txt |

## GodEye
- Engine: `requests` (no browser engine) → **no screenshot produced** (godeye.png absent; screenshot_path null).
- Homepage 200, title "Adrian's Mind", 2 same-origin links (/explore 200, /login 200), **0 broken same-origin links**, 69 buttons, 2 forms, 4 inputs, 0 console errors (requests engine cannot see JS errors).
- Scripts: /assets/index-qV1VC2j2.js, https://grok.com/grok-app-builder/extensions.js.
- Note from tool: "in-repo implementation; upstream identity still unconfirmed".

## ZAP passive (in-repo passive probe; ZAP daemon not installed; active scan disabled)
- findings_count: 2
  - missing_content_security_policy (medium)
  - missing_permissions_policy (medium)
- Present: HSTS (preload), X-Content-Type-Options nosniff, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin.
- Both findings = standing residual CSP + Permissions-Policy (not new).
