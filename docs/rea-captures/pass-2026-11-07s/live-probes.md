# Live probes pass 2026-11-07s

Product: **Adrian's Mind** / Adrian's Mind Command OS.  
Captured: 2026-11-07 04:25 WAT (Africa/Lagos). Read-only curl vs https://adrians-mind.vercel.app.

## Page routes

| Path | Code | Redirect |
|------|------|----------|
| `/` | 200 | — |
| `/login` | 200 | — |
| `/dashboard` | 307 | `/login?next=%2Fdashboard` |
| `/memory` | 200 | — |
| `/explore` | 200 | — |
| `/tools` | 404 | — |
| `/voice` | 404 | — |
| `/artifacts` | 404 | — |
| `/settings` | 404 | — |
| `/activity` | 404 | — |
| `/scheduled` | 404 | — |
| `/library` | 404 | — |
| `/projects` | 404 | — |

## OAuth status (HEAD + GET)

| Endpoint | Code |
|----------|------|
| `/api/mind/oauth/github/status` | 401 |
| `/api/mind/oauth/gmail/status` | 401 |
| `/api/mind/oauth/google_calendar/status` | 401 |
| `/api/mind/oauth/google_drive/status` | 401 |
| `/api/mind/oauth/notion/status` | 401 |
| `/api/mind/oauth/slack/status` | 401 |

## Live asset

`/assets/index-qV1VC2j2.js` (also third-party `https://grok.com/grok-app-builder/extensions.js` via GodEye).

## Security headers (home)

Present: Referrer-Policy, HSTS, X-Content-Type-Options, X-Frame-Options.  
**Missing:** Content-Security-Policy, Permissions-Policy.

## vs 07r

Probe status codes **UNCHANGED**. Asset **UNCHANGED**. Header residual pair **UNCHANGED**.
