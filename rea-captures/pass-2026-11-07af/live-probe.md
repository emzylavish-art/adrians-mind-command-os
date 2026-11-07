# Live probes — pass 2026-11-07af (curl, passive) — raw: live-probe.txt, pillar-probe.txt, home-headers.txt
- / 200, /login 200, /memory 200, /explore 200
- /dashboard 307 → /login?next=%2Fdashboard (with -L: final 200 at login)
- /tools /voice /chat /activity /library /projects /scheduled: all 404
- /api/mind/oauth/{github,gmail,google_calendar,google_drive,notion,slack}/status: all 401
- Live JS asset: index-qV1VC2j2.js (UNCHANGED)
- Headers: HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy present; CSP + Permissions-Policy absent (identical to 07ae)
- Result: byte-identical status table vs 07ae (diff clean).
