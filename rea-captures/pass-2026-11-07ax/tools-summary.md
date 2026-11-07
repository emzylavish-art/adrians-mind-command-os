# Tools summary — pass 2026-11-07ax (Adrian's Mind, live https://adrians-mind.vercel.app)
Run from /workspace/rea-features-wt; passive/read-only. 10:35 WAT.
| Tool | Exit | Result |
|---|---|---|
| godeye.py | 0 | requests engine; 200, title "Adrian's Mind", 69 buttons, 2 links, 2 forms, 4 inputs, 0 console errors, 0 broken same-origin links; screenshot=None (no browser engine → godeye.png not produced); upstream identity unconfirmed (standing) |
| zap_passive.py | 0 | 2 findings: missing CSP (medium), missing Permissions-Policy (medium) — standing |
| rea.py --help | 0 | rea-help.txt |
| security_review.py --help | 0 | security-review-help.txt |
Live bundle: /assets/index-ChogKXym.js (unchanged). Headers: HSTS, XFO DENY, nosniff, referrer-policy present; no CSP / Permissions-Policy.
Curl map: / 200, /login 200, /memory 200, /explore 200, /dashboard 307, /tools /voice /chat /activity /voice-cloning-studio /whisper-flow /api/tools/registry 404.
OAuth status ×6 (github, gmail, google_calendar, google_drive, notion, slack): 401 {"ok":false,"error":"Sign in is required."} (unauthenticated probe; standing).
