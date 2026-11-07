# Live HTTP probes — pass 2026-11-07ao
Target: https://adrians-mind.vercel.app
Time: 2026-11-07 ~08:57–08:58 Africa/Lagos (WAT)
Method: curl HEAD/GET, no auth session.

## Asset
- Live JS: `assets/index-qV1VC2j2.js` (**UNCHANGED** vs prior)
- Also present: `react-DB-4Zxce.js`, `actions-BG0IWsrI.js`, `workspace-BJAXxp_0.js`, …

## Page probes

| Path | Status | Redirect / notes |
|------|--------|------------------|
| `/` | 200 | OK |
| `/login` | 200 | OK |
| `/dashboard` | 307 → `/login?next=%2Fdashboard` | curl follows to 200 login (**standing**: curl 307 vs browser) |
| `/memory` | 200 | No auth redirect on HEAD (SPA shell) |
| `/explore` | 200 | No auth redirect on HEAD (SPA shell / TEMPLATE standing) |
| `/tools` | 404 | Server 404; HTML title still "Adrian's Mind" |
| `/voice` | 404 | Server 404 |
| `/chat` | 404 | Server 404 |
| `/activity` | 404 | Server 404 |

## OAuth status ×6 (expect 401 known)

| Endpoint | Status | Body |
|----------|--------|------|
| `/api/mind/oauth/github/status` | 401 | `{"ok":false,"error":"Sign in is required."}` |
| `/api/mind/oauth/gmail/status` | 401 | same |
| `/api/mind/oauth/google_calendar/status` | 401 | same |
| `/api/mind/oauth/google_drive/status` | 401 | same |
| `/api/mind/oauth/notion/status` | 401 | same |
| `/api/mind/oauth/slack/status` | 401 | same |

**UNCHANGED** vs standing OAuth×6 401.

## Security headers on `/`
Present: `strict-transport-security`, `referrer-policy`, `x-content-type-options: nosniff`, `x-frame-options: DENY`.
**ABSENT:** `Content-Security-Policy`, `Permissions-Policy` (matches `vercel.json` on main — only the three X-/Referrer headers).

## Other
- `/extensions.js` → **404**
- `/assets/extensions.js` → **404**
- `/favicon.ico` 404; `/robots.txt` 404; `/manifest.webmanifest` 404; `/sw.js` 404
- `/assets/index-qV1VC2j2.js` → 200
- Bundle keyword scan of index asset: no hits for `extensions.js`, `/tools`, `/voice`, `/chat`, `whisper`, `voice-cloning`, `GodEye`, `BlackEye`, `Artifacts`, `live-search`, `TEMPLATE`.
