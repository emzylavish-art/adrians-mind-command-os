# Live probe — https://adrians-mind.vercel.app (2026-11-07 06:21 WAT (05:21 UTC)), passive curl only
| path | status |
|---|---|
| / | 200 |
| /login | 200 |
| /dashboard | 307 -> /login?next=%2Fdashboard |
| /memory | 200 |
| /explore | 200 |
| /tools /voice /chat /activity | 404 |
OAuth status github/gmail/google_calendar/google_drive/notion/slack: all 401 {"ok":false,"error":"Sign in is required."}
Main bundle: /assets/index-qV1VC2j2.js (unchanged)
Headers present: HSTS preload, X-Frame-Options DENY, nosniff, Referrer-Policy strict-origin-when-cross-origin. MISSING: Content-Security-Policy, Permissions-Policy.
Prod deploy (GitHub Deployments API, Production): e3ccc51 created 2026-11-06 05:38 WAT — unchanged. Vercel MCP get_deployment/list_deployments returned 404 (no team scope), not used.
