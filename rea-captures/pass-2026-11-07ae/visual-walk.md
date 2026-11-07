# Adrian's Mind — visual walk

**Pass:** 2026-11-07ae · **Mode:** read-only; no content saved, sent, deleted, or edited.  
**Capture dir:** `/workspace/rea-captures/pass-2026-11-07ae/`

## Outcome / delta vs 07ad

- `/dashboard` rendered the Universe dashboard directly in the existing browser tab; it did **not** bounce to `/login`. The previous 07ad diff notes `/dashboard` as 307→login. No password login was attempted. No login wall appeared; the root chat UI does prompt sign-in for voice/connected services, so this pass confirms direct rendering, not backend-authenticated access to every feature.
- The first dashboard paint showed “Painting the universe…”. The Universe list appeared about 0.9 s after navigation; the 3D scene was visible. Diving changed the camera to “Projects city”; labels/buildings rendered, but progress remained unknown and an Interior panel said building data unavailable.
- No clearly new broken behavior was established. The observations largely match the supplied standing gaps: deep-link 404, repeated `forbidden_cross_site`, empty data panels, Explore templates, Grok-status ambiguity, and no Scheduled worker. `/memory` and `/explore` did render in this pass. The positive change is dashboard direct-load instead of the prior login redirect.

## Views

| View / URL | What rendered | Broken, missing, status |
|---|---|---|
| Dashboard — `/dashboard` | Universe dashboard; 18 bots listed idle; system weather “Quiet void”; 4 feed events. | Notion galaxy/mirror unavailable (no snapshot, `NOTION_TOKEN` unset); Money has no spend source; Fleet plan queue unavailable; no git/lock history; commit/activity/spend charts empty; landing lanes 0 hops; interior building data unavailable. All 18 bot/building progress values idle/unknown. The standalone Universe view rendered (rather than the root app shell). Filters toggle was present but did not open after repeated click attempts/timeouts. Dive-to-city did change to Projects city. |
| Requested `home/chat` — `/home/chat` | None; returned HTTP 404 “Page not found”. | The actual Chat workspace is at `/` and rendered normally. The home/chat root shows “Grok configured” after status settles, Memory off, no local projects, and recent forbidden-cross-site activity. It also says sign-in is needed for voice and connected services. |
| Memory — `/memory` | Memory manager form and search. | No saved memory; project/chat scopes disabled until an owner is selected. No changes made. |
| Explore — `/explore` | Persona directory and category tabs; cards marked TEMPLATE / Not live. My agents category has 0 local personas. | No live remote personas; selected-agent handoff is explicitly unverified. Did not save/open a template. |
| Library — in-app view (URL stays `/`) | Library panel, Upload text / Browse Drive controls. | No files; empty “Select a file” panel. Upload/Drive controls not activated. |
| Projects — in-app view (URL stays `/`) | 0 local projects; 2 external labels (Oak Bridge Capital, BridgePoint). | No local tasks/files/progress. Opened Create project modal and Cancelled; no project created. |
| Scheduled — in-app view (URL stays `/`) | Scheduled tasks panel. | “No worker process is running”; no schedules; tasks are local, not hosted scheduling. Add/run controls were not activated. |
| Activity — in-app view (URL stays `/`) | 151 activity rows. | 150 rows are `forbidden_cross_site` / “Forbidden: cross-site request blocked”; one “New session started”. This matches the standing cross-site issue. |
| Connected — in-app view (URL stays `/`) | Grok says “Key present”; other provider cards/statuses visible. | Grok text explicitly says not live-verified. OAuth services show not configured/missing server vars; Google Docs has no connection; OpenAI/Claude/Gemini/OpenRouter/search unconfigured; image/video not called; voice not realtime; MCP not connected; local computer not paired. No OAuth sign-in was attempted and no 401 was observed in this walk. |
| Tools — in-app view (URL stays `/`) | Local list-projects/list-chats/search-notes and delegate show Available; Web search, Browser, Gmail, Model show Not available. | A visible `Forbidden: cross-site request blocked` banner appeared, with Retry/View log/Dismiss; PC shell approvals showed the same refusal; MCP server/tool status was still loading in the first snapshot. No retry or tool action was taken. The refusal was reported through the site-block reporting tool. |
| Settings / Safe Keys — in-app view (URL stays `/`) | Preferences and Safe Keys inventory. | Provider failover off. Voice, Chat, Image, Video, Code and GPT all say “Not connected — configuration unavailable”; page says configuration status is unverified and no secret input/reveal/save is available. This conflicts in wording with the shell’s “Grok configured” / Connected “Key present”, so treat that as presence only, not verified operation. No settings changed. |

## Safe controls exercised

- Create project: opened modal, then Cancel; no mutation.
- Dashboard: attempted Filters toggle repeatedly (did not open; click timed out); Dive to city changed the view to Projects city.
- Scheduled: inspected worker/schedule status only; did not add or run a job.
- No send, delete, save, OAuth, payment, or destructive control used.

## Block / errors

- No captcha or login page encountered; no credentials entered.
- Tools displayed a server-refusal banner: `Forbidden: cross-site request blocked`. The matching Activity history contains 150 such entries. No retry was made.
- Dashboard Universe list became available about 0.9 s after navigation; no prolonged Universe hang observed in this pass.

## Screenshots

1. `01-dashboard.png` — Universe dashboard
2. `02-home-chat.png` — `/home/chat` 404
3. `03-memory.png` — Memory manager
4. `04-explore.png` — Explore templates
5. `05-chat-home.png` — root Chat workspace
6. `06-library.png` — Library empty state
7. `07-project-create-modal.png` — Create project modal
8. `08-projects.png` — Projects view
9. `09-scheduled.png` — Scheduled tasks / no worker
10. `10-connected.png` — Connected integrations
11. `11-activity.png` — repeated forbidden-cross-site activity
12. `12-tools.png` — Tools and refusal banner
13. `13-settings-safe-keys.png` — Safe Keys inventory
14. `14-dashboard-city.png` — dashboard after Dive to city
