# Pass 2026-11-06g — Live HTTP probes

Target: https://adrians-mind.vercel.app  
Captured: Fri Nov 6, 2026 ~4:55 PM CST (Fri Nov 6, 2026 ~11:55 PM WAT)

## Bundle

| Item | 06f | 06g |
|---|---|---|
| App JS | `index-qV1VC2j2.js` | `index-qV1VC2j2.js` **UNCHANGED** |
| Third-party | `https://grok.com/grok-app-builder/extensions.js` | same **UNCHANGED** |
| Title | Adrian's Mind | Adrian's Mind |

## Route table

| Path | HTTP (follow) | Notes vs 06f |
|---|---|---|
| `/` | 200 | SPA shell |
| `/login` | 200 | |
| `/memory` | 200 | |
| `/explore` | 200 | |
| `/dashboard` | 200 after 1 redirect | 307 → `/login?next=%2Fdashboard` (auth gate) |
| `/voice` | 404 | sidebar deep-link |
| `/tools` | 404 | |
| `/artifacts` | 404 | |
| `/settings` | 404 | |
| `/imagine` | 404 | |
| `/bots` | 404 | |
| `/chat` | 404 | |
| `/workspace` | 404 | |
| `/agents` | 404 | |
| `/automations` | 404 | |

All statuses match 06f.

## OAuth status (`/api/mind/oauth/{…}/status`)

All six return **401** `{"ok":false,"error":"Sign in is required."}` — github, gmail, google_calendar, google_drive, notion, slack. **UNCHANGED**.

## Security headers on `/`

| Header | Present? | Note |
|---|---|---|
| Content-Security-Policy | **No** | residual |
| Permissions-Policy | **No** | residual |
| X-Content-Type-Options | Yes | `nosniff` |
| X-Frame-Options | Yes | `DENY` |
| Referrer-Policy | Yes | `strict-origin-when-cross-origin` |
| Strict-Transport-Security | Yes | `max-age=63072000; includeSubDomains; preload` |

Vercel id sample: `iad1::iad1::…` (no production git SHA in response headers).

## Audit secret (domain only)

`REA_AUDIT_EMAIL` domain still **example.com** (placeholder). Local: `rea.audit.…@REDACTED` → example.com. **UNCHANGED**.
