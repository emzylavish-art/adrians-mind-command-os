# Live probe — https://adrians-mind.vercel.app (2026-11-07 06:30 WAT (05:30 UTC)), passive curl only
| path | status |
|---|---|
| / | 200 |
| /login | 200 |
| /dashboard | 307 -> /login?next=%2Fdashboard |
| /memory | 200 |
| /explore | 200 |
| /tools | 404 |
| /voice | 404 |
| /chat | 404 |
| /activity | 404 |
OAuth status:
- github: 401 {"ok":false,"error":"Sign in is required."}
- gmail: 401 {"ok":false,"error":"Sign in is required."}
- google_calendar: 401 {"ok":false,"error":"Sign in is required."}
- google_drive: 401 {"ok":false,"error":"Sign in is required."}
- notion: 401 {"ok":false,"error":"Sign in is required."}
- slack: 401 {"ok":false,"error":"Sign in is required."}
Main bundle: /assets/index-qV1VC2j2.js
Response headers on /:
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: DENY
