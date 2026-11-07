# Live probes — pass 2026-11-07w

| Path | Result |
|---|---|
| `/` | 200 |
| `/login` | 200 |
| `/memory` | 200 |
| `/explore` | 200 |
| `/dashboard` | 307 → `/login?next=%2Fdashboard` |
| `/tools` `/voice` `/chat` `/activity` | 404 |
| OAuth status ×6 (github/gmail/google_calendar/google_drive/notion/slack) | **401** |

Audit secret email domain still `example.com` (routed 06d). Password login not attempted (placeholder + secure credential fill unavailable in automation).
