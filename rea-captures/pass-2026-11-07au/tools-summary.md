# Tools summary — pass 2026-11-07au
- godeye.py exit 0; title "Adrian's Mind", status 200, 69 buttons, 2 forms, 4 inputs, 0 console errors, 0 broken same-origin links; engine=requests so no screenshot produced (godeye.png absent). godeye.err empty.
- zap_passive.py exit 0; 2 medium findings: missing CSP, missing Permissions-Policy (unchanged). HSTS, XFO DENY, nosniff, referrer-policy present. zap.err empty.
- rea.py --help exit 0; security_review.py --help exit 0.
## Probes
/ 200, /login 200, /memory 200, /explore 200, /dashboard 307 -> /login?next=%2Fdashboard, /tools /voice /chat /activity 404.
OAuth status github/gmail/google_calendar/google_drive/notion/slack: all 401.
## Registry note
main tools/registry.json still lists a "BlackEye" entry (blueprint: GodEye only). No godeye/whisper/voice-clone files on main or preview tree.
