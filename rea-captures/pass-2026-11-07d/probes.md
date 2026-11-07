# Live curl probes — pass 2026-11-07d (unsigned)
Product: **Adrian's Mind**. Base: https://adrians-mind.vercel.app
Captured: 2026-11-07 01:07:25 WAT (Africa/Lagos)
Method: curl `--max-redirs 0` (status of first hop); HTML fetched with `--compressed`.

## Routes

| Path | Status | Notes |
|---|---|---|
| `/` | **200** | UNCHANGED |
| `/login` | **200** | UNCHANGED |
| `/memory` | **200** | UNCHANGED |
| `/explore` | **200** | UNCHANGED |
| `/dashboard` | **307** → `/login?next=%2Fdashboard` | UNCHANGED (unsigned curl) |
| `/tools` | **404** | sidebar deep-link; UNCHANGED |
| `/voice` | **404** | UNCHANGED |
| `/artifacts` | **404** | UNCHANGED |
| `/settings` | **404** | UNCHANGED |
| `/activity` | **404** | UNCHANGED |
| `/scheduled` | **404** | UNCHANGED |

## OAuth status ×6 (07c connector set)

| Endpoint | Status | Body |
|---|---|---|
| `/api/mind/oauth/github/status` | **401** | Sign in is required. |
| `/api/mind/oauth/gmail/status` | **401** | Sign in is required. |
| `/api/mind/oauth/google_calendar/status` | **401** | Sign in is required. |
| `/api/mind/oauth/google_drive/status` | **401** | Sign in is required. |
| `/api/mind/oauth/notion/status` | **401** | Sign in is required. |
| `/api/mind/oauth/slack/status` | **401** | Sign in is required. |

All six **UNCHANGED** vs 07c.

## Live JS bundle
- From `/` HTML: `/assets/index-qV1VC2j2.js` (also react-DB-4Zxce.js, actions-BG0IWsrI.js, …)
- Bundle name **UNCHANGED** vs 07c (`index-qV1VC2j2.js`)

## Security headers on `/`
Present: `referrer-policy: strict-origin-when-cross-origin`; `strict-transport-security: max-age=63072000; includeSubDomains; preload`; `x-content-type-options: nosniff`; `x-frame-options: DENY`
Absent: **Content-Security-Policy**, **Permissions-Policy** — **UNCHANGED**

## extensions.js
- Still referenced: `https://grok.com/grok-app-builder/extensions.js` — **UNCHANGED**

## Artifacts
- `root.html`, `headers-root.txt`, `probes-raw.txt` (initial pass; OAuth names corrected in this file)
