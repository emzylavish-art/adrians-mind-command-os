# Live curl probes — pass 2026-11-07f (unsigned)
Product: **Adrian's Mind**. Base: https://adrians-mind.vercel.app
Captured: 2026-11-07 01:38:13 WAT (Africa/Lagos)
Method: curl HEAD/status of first hop (no follow for redirect observation); HTML with `--compressed`.

## Routes

| Path | Status | Notes |
|---|---|---|
| `/` | **200** | UNCHANGED |
| `/login` | **200** | UNCHANGED |
| `/memory` | **200** | UNCHANGED |
| `/explore` | **200** | UNCHANGED |
| `/dashboard` | **307** → `/login?next=%2Fdashboard` | UNCHANGED (expected for unsigned curl) |
| `/tools` | **404** | sidebar deep-link; UNCHANGED |
| `/voice` | **404** | UNCHANGED |
| `/artifacts` | **404** | UNCHANGED |
| `/settings` | **404** | UNCHANGED |
| `/activity` | **404** | UNCHANGED |
| `/scheduled` | **404** | UNCHANGED |

Raw: `live-probes-raw.txt`

## OAuth status ×6

| Endpoint | Status | Body |
|---|---|---|
| `/api/mind/oauth/github/status` | **401** | Sign in is required. |
| `/api/mind/oauth/gmail/status` | **401** | Sign in is required. |
| `/api/mind/oauth/google_calendar/status` | **401** | Sign in is required. |
| `/api/mind/oauth/google_drive/status` | **401** | Sign in is required. |
| `/api/mind/oauth/notion/status` | **401** | Sign in is required. |
| `/api/mind/oauth/slack/status` | **401** | Sign in is required. |

All six **UNCHANGED** vs 07e.

## Live JS bundle
- From `/` HTML: `/assets/index-qV1VC2j2.js`
- Bundle name **UNCHANGED** vs 07e (`index-qV1VC2j2.js`)
- Third-party script still present: `https://grok.com/grok-app-builder/extensions.js`

## Security headers on `/`
**Present:** `referrer-policy: strict-origin-when-cross-origin`; `strict-transport-security: max-age=63072000; includeSubDomains; preload`; `x-content-type-options: nosniff`; `x-frame-options: DENY`

**Missing (confirmed by ZAP + curl):** Content-Security-Policy; Permissions-Policy — **UNCHANGED**

Artifacts: `curl-root-headers.txt`, `curl-root-get-headers.txt`, `live-index.html`
