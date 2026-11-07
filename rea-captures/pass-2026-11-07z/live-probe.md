# Live probes — pass-2026-11-07z
Captured: 2026-11-07 06:03 WAT (Africa/Lagos)

## Route status codes

| Path | Method | HTTP | Redirect/Notes |
|------|--------|------|----------------|
| `/` | GET (no-follow) | 200 | HTTP/2 200 |
| `/login` | GET (no-follow) | 200 | HTTP/2 200 |
| `/dashboard` | GET (no-follow) | 307 | → `/login?next=%2Fdashboard` (follow → 200) |
| `/memory` | GET (no-follow) | 200 | HTTP/2 200 |
| `/explore` | GET (no-follow) | 200 | HTTP/2 200 |
| `/tools` | GET (no-follow) | 404 | HTTP/2 404 |
| `/voice` | GET (no-follow) | 404 | HTTP/2 404 |
| `/chat` | GET (no-follow) | 404 | HTTP/2 404 |
| `/activity` | GET (no-follow) | 404 | HTTP/2 404 |

## OAuth status endpoints (OAuth×6)

| Endpoint | HTTP | Body snippet |
|----------|------|--------------|
| `/api/mind/oauth/github/status` | 401 | `{"ok":false,"error":"Sign in is required."}` |
| `/api/mind/oauth/gmail/status` | 401 | `{"ok":false,"error":"Sign in is required."}` |
| `/api/mind/oauth/google_calendar/status` | 401 | `{"ok":false,"error":"Sign in is required."}` |
| `/api/mind/oauth/google_drive/status` | 401 | `{"ok":false,"error":"Sign in is required."}` |
| `/api/mind/oauth/notion/status` | 401 | `{"ok":false,"error":"Sign in is required."}` |
| `/api/mind/oauth/slack/status` | 401 | `{"ok":false,"error":"Sign in is required."}` |

## Live JS bundle from HTML
```
index-qV1VC2j2.js
/assets/index-qV1VC2j2.js
/assets/react-DB-4Zxce.js
/assets/actions-BG0IWsrI.js
/assets/link-Lxx_zRdo.js
/assets/route-BAhszpLd.js
/assets/jsx-runtime-BtH0gOTJ.js
/assets/routes-wC3KRy8L.js
/assets/client-CJ-to4pt.js
/assets/workspace-BJAXxp_0.js
/assets/memory-saved-indicator-DIEJAYLn.js
```

Also observed in GodEye scripts: `https://grok.com/grok-app-builder/extensions.js`

## Security headers (from `/`)

Present:
- `strict-transport-security: max-age=63072000; includeSubDomains; preload`
- `x-frame-options: DENY`
- `x-content-type-options: nosniff`
- `referrer-policy: strict-origin-when-cross-origin`

Missing (confirmed):
- Content-Security-Policy
- Permissions-Policy

## Vs standing gaps (live lane)

| Standing gap | This pass |
|---|---|
| OAuth×6 401 | **Confirmed** (all 6) |
| Residual CSP + Permissions-Policy | **Confirmed** missing |
| Deep-link 404s `/tools` `/voice` `/chat` `/activity` | **Confirmed** |
| `/dashboard` curl 307 → login | **Confirmed** |
| Live asset `index-qV1VC2j2.js` | **UNCHANGED** |

Raw curl transcript: `live-probe-raw.txt`
