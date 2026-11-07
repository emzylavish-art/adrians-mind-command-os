# Live probe — pass 2026-11-07v
Timezone note: probe wall times on box ≈ 2026-11-06 22:11–22:13 CST (UTC−6) ≈ 2026-11-07 05:11–05:13 WAT (Africa/Lagos).

Target: https://adrians-mind.vercel.app

## Route status (curl -sI / GET)

| Path | HTTP | Notes vs 2026-11-07u |
|---|---|---|
| `/` | 200 | UNCHANGED |
| `/login` | 200 | UNCHANGED |
| `/memory` | 200 | UNCHANGED |
| `/explore` | 200 | UNCHANGED |
| `/dashboard` | 307 → `/login?next=%2Fdashboard` | UNCHANGED |
| `/tools` | 404 | UNCHANGED |
| `/voice` | 404 | UNCHANGED |
| `/artifacts` | 404 | UNCHANGED |
| `/settings` | 404 | UNCHANGED |
| `/activity` | 404 | UNCHANGED |
| `/scheduled` | 404 | UNCHANGED |
| `/library` | 404 | UNCHANGED |
| `/projects` | 404 | UNCHANGED |
| `/agents` | 404 | UNCHANGED |
| `/chat` | 404 | UNCHANGED |
| `/whisper` | 404 | UNCHANGED |
| `/voice-cloning` | 404 | UNCHANGED |
| `/connected` | 404 | UNCHANGED |
| `/skills` | 404 | UNCHANGED |
| `/builds` | 404 | UNCHANGED |
| `/runs` | 404 | UNCHANGED |
| `/help` | 404 | UNCHANGED |
| `/search` | 404 | UNCHANGED |
| `/api/health` | 404 | UNCHANGED |
| `/api/mind/health` | 404 | UNCHANGED |
| `/api/mind/tools` | 404 | UNCHANGED |
| `/api/mind/registry` | 404 | UNCHANGED |
| `/auth/callback` | 302 → login?error=Missing+authorization+code | expected without code |

## OAuth status ×6 (GET body)

All return **401** `{"ok":false,"error":"Sign in is required."}` — **UNCHANGED**:

- `/api/mind/oauth/github/status`
- `/api/mind/oauth/gmail/status`
- `/api/mind/oauth/google_calendar/status`
- `/api/mind/oauth/google_drive/status`
- `/api/mind/oauth/notion/status`
- `/api/mind/oauth/slack/status`

## Live asset

Homepage title `Adrian's Mind`. Primary bundle: **`assets/index-qV1VC2j2.js`** — **UNCHANGED**.

Also linked: `assets/routes-wC3KRy8L.js`, `assets/workspace-BJAXxp_0.js`, `assets/actions-BG0IWsrI.js`, react/runtime chunks, CSS `styles-BTes9Ayn.css` + `routes-DJ6fWTpc.css`.

Third-party: `https://grok.com/grok-app-builder/extensions.js` still loaded — standing gap, not NEW.

## Security response headers (GET `/`)

Present: `strict-transport-security`, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: strict-origin-when-cross-origin`.

Missing: **Content-Security-Policy**, **Permissions-Policy** — **UNCHANGED**.

## Audit email / placeholders

- Login placeholder still `you@example.com` (login.html).
- Routes bundle still has form placeholders `name@example.com` and `https://example.com`.
Standing gap “audit email still example.com” — **UNCHANGED** (placeholder evidence; no live authenticated audit-account probe this method).

## GodEye UI signal (unsigned-in home)

69 buttons (sidebar nav as `<button>`s not `<a href>`); only 2 same-origin links (`/explore`, `/login`); 0 broken anchors; 0 console errors in this run.
