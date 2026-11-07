# Live probes — pass 2026-11-07an (curl, passive) ~08:45 WAT
| path | HEAD | GET |
|---|---|---|
| / | 200 | 200 41255 |
| /login | 200 | 200 10529 |
| /dashboard | 307 | 307 0 |
| /memory | 200 | 200 3222 |
| /explore | 200 | 200 3105 |
| /tools | 404 | 404 3183 |
| /voice | 404 | 404 3183 |
| /chat | 404 | 404 3183 |
| /activity | 404 | 404 3183 |
| /library | 404 | 404 3183 |
| /projects | 404 | 404 3183 |
| /scheduled | 404 | 404 3183 |
| /settings | 404 | 404 3183 |
| /whisper | 404 | 404 3183 |
| /voice-cloning | 404 | 404 3183 |

/dashboard → 307 Location /login?next=%2Fdashboard (curl; standing "curl 307 vs browser")

## OAuth status (/api/mind/oauth/{c}/status)
github, gmail, google_calendar, google_drive, notion, slack → all 401 {"ok":false,"error":"Sign in is required."}

## Bundle
Live asset /assets/index-qV1VC2j2.js — UNCHANGED

## Headers (/)
HSTS preload, X-Frame-Options DENY, nosniff, Referrer-Policy present; NO Content-Security-Policy, NO Permissions-Policy (standing)
