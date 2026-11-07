# Live probes — pass-2026-11-07y
Captured: 2026-11-07 05:47:06 WAT (Africa/Lagos)

## Route status codes

| Path | Method | HTTP | Redirect/Notes |
|------|--------|------|----------------|
| `/` | GET (no-follow) | 200 | HTTP/2 200  |
| `/login` | GET (no-follow) | 200 | HTTP/2 200  |
| `/dashboard` | GET (no-follow) | 307 | /login?next=%2Fdashboard |
| `/memory` | GET (no-follow) | 200 | HTTP/2 200  |
| `/explore` | GET (no-follow) | 200 | HTTP/2 200  |
| `/tools` | GET (no-follow) | 404 | HTTP/2 404  |
| `/voice` | GET (no-follow) | 404 | HTTP/2 404  |
| `/chat` | GET (no-follow) | 404 | HTTP/2 404  |
| `/activity` | GET (no-follow) | 404 | HTTP/2 404  |

## OAuth status endpoints

| Endpoint | HTTP | Body snippet |
|----------|------|--------------|
| `/api/mind/oauth/github/status` | 401 | {"ok":false,"error":"Sign in is required."}  |
| `/api/mind/oauth/gmail/status` | 401 | {"ok":false,"error":"Sign in is required."}  |
| `/api/mind/oauth/google_calendar/status` | 401 | {"ok":false,"error":"Sign in is required."}  |
| `/api/mind/oauth/google_drive/status` | 401 | {"ok":false,"error":"Sign in is required."}  |
| `/api/mind/oauth/notion/status` | 401 | {"ok":false,"error":"Sign in is required."}  |
| `/api/mind/oauth/slack/status` | 401 | {"ok":false,"error":"Sign in is required."}  |

## Live JS bundle from HTML
```
index-qV1VC2j2.js
assets/actions-BG0IWsrI.js
assets/client-CJ-to4pt.js
assets/index-qV1VC2j2.js
assets/jsx-runtime-BtH0gOTJ.js
assets/link-Lxx_zRdo.js
assets/memory-saved-indicator-DIEJAYLn.js
assets/react-DB-4Zxce.js
assets/route-BAhszpLd.js
assets/routes-wC3KRy8L.js
assets/workspace-BJAXxp_0.js
```

### CSP / Permissions-Policy headers (from /)
HTTP/2 200 
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-frame-options: DENY
