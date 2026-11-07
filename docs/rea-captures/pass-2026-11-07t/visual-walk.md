# Adrian's Mind — visual walk

- **Pass:** `2026-11-07t`
- **Audited:** 2026-11-07, read-only, existing box browser context
- **Product:** https://adrians-mind.vercel.app
- **Auth:** `/dashboard` opened directly; no `/login` bounce and no sign-in attempt. Read-only views were accessible in the existing browser context. Auth state was not independently verified; no `AUTH_WALK_BLOCKED` condition.
- **Universe:** **Painted — yes.** Initially showed “Painting the universe…”; after the requested ~20-second wait it cleared and the constellation rendered. The snapshot showed 18 idle bots, with painter/light/motion pending and 0 hops reached.
- **Bundle:** `/assets/index-qV1VC2j2.js` (also saw `https://grok.com/grok-app-builder/extensions.js`).
- **Writes:** None. Did not submit forms, save notes, create/queue/run work, use Retry, sign in, or change settings.

## Per-view observations

| View | What rendered / issues | Evidence |
|---|---|---|
| Dashboard `/dashboard` | Universe canvas painted. Side panels: Notion galaxy unavailable (“No Notion snapshot file found and NOTION_TOKEN unset”); money has no spend source; fleet queue unavailable; “Quiet void · 18 idle · no active claims”; no git/lock history; charts mostly “no source yet”; interior reports building data unavailable. Feed had three pending landings (0 hops) and a Merge Gate entry. | `01-dashboard.png` |
| Memory `/memory` | Memory manager; no saved memory. Global notes can be added; project/chat scopes require an owner. Left all controls untouched. | `02-memory.png` |
| Explore `/explore` | Persona directory, 10 built-in cards visible, each marked `TEMPLATE` / `NOT LIVE`; My agents 0. Copy says these are local templates, not live remote personas; selected-agent handoff not verified. | `03-explore.png` |
| Library | No files yet. Text copies only; the page distinguishes them from originals/cloud Drive. | `04-library.png` |
| Projects | No on-device projects. Two external labels are shown as unchanged and explicitly outside this app. | `05-projects.png` |
| Scheduled | Initially “Checking the worker”; settled to “No worker process is running. Schedules stay saved. Nothing is running in the background.” Local DB, not hosted scheduling; no schedules yet. Did not add/run jobs. | `06-scheduled.png` |
| Activity | Repeated `forbidden_cross_site` / “Forbidden: cross-site request blocked” records (dozens in the list), plus a top error banner with Retry / View log / Dismiss. No retry. | `07-activity.png` |
| Connected | Grok says `KEY PRESENT`, but explicitly “not a live-verified integration.” Notion, GitHub, Gmail, Drive, Calendar, Slack and MCP show not connected / not configured states; several connection checks were still “Checking connection…” at capture. Other model/search services are not configured. | `08-connected.png` |
| Safe Keys | Voice, Chat, Image, Video, Code and GPT all show `NOT CONNECTED — CONFIGURATION UNAVAILABLE`; page says secure storage/status is unverified and no secret values are available. | `18-safe-keys.png` |
| Tools | List projects/chats/search notes and delegate marked available (local reads); browser, web search, Gmail and model unavailable. No browser sessions. PC shell approvals and MCP server/tools panels still showed loading text at capture. | `09-tools.png` |
| Skills | Project/chat/note local skills `ON`; Notion, cloud browser, voice and Gmail `NOT INSTALLED`. A `Forbidden: cross-site request blocked` banner and Retry button were visible; did not retry. | `10-skills.png` |
| Build | No build running; no paired PC agent. Page says it does not edit repositories or run terminals. | `11-build.png` |
| Runs | No runs yet; “Queue run” / “Run worker once” controls present. Left untouched. | `12-runs.png` |
| Research | No citations; search provider/key not configured. File inspection is staged text only; no report yet. | `13-research.png` |
| Bots & Agents | No saved agents or REA report. Bounded planner not running; template definitions are not deployed. | `14-agents.png` |
| Settings / Help / Chat home | Settings exposes workspace/system navigation and Safe Keys. Help says nothing runs in the background and Grok “Key present” is not proof of a live connection. Chat home showed no active projects, Memory off, REA partial, HP not paired, and recent `forbidden_cross_site` activity. | `15-settings.png`, `16-help.png`, `17-chat-home.png`, `19-memory-workspace.png` |

## Known issues observed

- `forbidden_cross_site` persisted in the Skills/Memory/Activity/Build/Runs/Research/Agents views and recent activity, with Retry banners; no retry was attempted.
- Empty panels/data sources remain: notes, local projects, Library files, schedules, runs, citations, Notion snapshot, spend source, git/lock history and most charts.
- Explore templates are explicitly `TEMPLATE` / `NOT LIVE`.
- Scheduled worker is not running; no background scheduling.
- Grok status is inconsistent across surfaces: header says **Grok configured**, Connected says **KEY PRESENT** (not live verified), while Safe Keys says **Chat NOT CONNECTED — CONFIGURATION UNAVAILABLE**. The Connected/Help copy does qualify key presence as not live verification.

## New symptoms

No clearly new persistent issue distinguished from the known list supplied for this pass. At capture, Tools still displayed `Loading PC shell approvals…`, `Loading MCP servers…`, and `Loading MCP tools…`; this may be transient and was not rechecked. The public standalone guessed paths `/activity`, `/tools`, `/skills`, `/runs`, `/build`, `/agents`, `/projects`, `/library`, `/scheduled`, `/connected`, and `/safe-keys` returned the app’s “Page not found”; their corresponding views were reachable through Settings in the root workspace UI. Only `/dashboard`, `/memory`, and `/explore` were useful direct routes in this walk.

## Screenshot index

`01-dashboard.png`, `02-memory.png`, `03-explore.png`, `04-library.png`, `05-projects.png`, `06-scheduled.png`, `07-activity.png`, `08-connected.png`, `09-tools.png`, `10-skills.png`, `11-build.png`, `12-runs.png`, `13-research.png`, `14-agents.png`, `15-settings.png`, `16-help.png`, `17-chat-home.png`, `18-safe-keys.png`, `19-memory-workspace.png`.
