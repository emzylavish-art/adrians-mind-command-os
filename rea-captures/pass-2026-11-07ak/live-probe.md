# Live probe — pass 2026-11-07ak
Target: https://adrians-mind.vercel.app only  
Captured: 2026-11-07 08:05 WAT (Africa/Lagos)

## Route status (curl -sI)
| Path | Status | Notes |
|---|---|---|
| / | 200 | |
| /login | 200 | |
| /dashboard | 307 | Location: /login?next=%2Fdashboard |
| /memory | 200 | |
| /explore | 200 | |
| /tools | 404 | known |
| /voice | 404 | known |
| /chat | 404 | known |
| /activity | 404 | known |
| /library | 404 | known |
| /projects | 404 | known |
| /scheduled | 404 | known |
| /whisper-flow | 404 | known pillar path |
| /voice-cloning-studio | 404 | known pillar path |

All route outcomes **UNCHANGED** vs 07aj live-probe.txt.

## OAuth status (unauthenticated)
Pattern from 07aj: `/api/mind/oauth/{provider}/status`

| Endpoint | Status |
|---|---|
| oauth/github/status | 401 |
| oauth/gmail/status | 401 |
| oauth/google_calendar/status | 401 |
| oauth/google_drive/status | 401 |
| oauth/notion/status | 401 |
| oauth/slack/status | 401 |

**UNCHANGED** (known OAuth×6 401).

## Live JS bundle
- Primary: `index-qV1VC2j2.js` — **UNCHANGED** vs 07aj
- Third-party: `https://grok.com/grok-app-builder/extensions.js` — known

## Security headers on /
Present: Referrer-Policy, Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options  
Missing: Content-Security-Policy, Permissions-Policy — **UNCHANGED** (known CSP+Permissions-Policy gap)

home.html saved alongside this file.
