# Adrian's Mind visual walk — pass 2026-11-07af

## Scope / session
- Opened `/dashboard` directly in the existing browser context. It did not bounce to `/login` and did not show “Something went wrong”; no credentials or sign-in attempts were made.
- The SPA’s local workspace was reachable. The chat UI still shows a sign-in prompt for voice and connected services; this walk did not sign in.
- Read-only walk. No projects, schedules, notes, or other data were created or changed.

## URLs visited and what painted
- `https://adrians-mind.vercel.app/dashboard` — initially showed “Painting the universe…”; then the 3D Universe painted with bot labels / scene. 18 bots showed idle, with 0 hops reached for painter/light/motion. Side cards reported Notion galaxy unavailable (no snapshot/token), no spend source, fleet queue unavailable, and quiet void. Charts had no data sources; interior panel said building data unavailable. Grok Build / Orchestrator appeared idle in the Universe list.
- `https://adrians-mind.vercel.app/library` (direct) — Page not found. Clicking **Library** in the SPA sidebar worked and painted the Library page, with no files yet; Upload text and Browse Drive controls were visible.
- `https://adrians-mind.vercel.app/projects` (direct) — Page not found. Sidebar **Projects** worked: no on-device projects; two external records (Oak Bridge Capital and BridgePoint) were marked external/unchanged.
- `https://adrians-mind.vercel.app/scheduled` (direct) — Page not found. Sidebar **Scheduled** worked: no schedules; worker status initially “Checking the worker…” and the page states the database is local, not hosted scheduling. It also says nothing is running in the background and provides local worker commands.
- `https://adrians-mind.vercel.app/explore` — Persona directory painted. Cards are clearly marked **TEMPLATE / NOT LIVE**; page says these are local templates, not live Poe or Character.AI personas, and selected-agent handoff is not verified.
- `https://adrians-mind.vercel.app/memory` — Memory manager painted with add-note form and empty state (“No saved memory yet”). Page says it can save global notes only; no note was added.
- `https://adrians-mind.vercel.app/tools` (direct) — Page not found. In-app Chat **Tools → Open Tools panel** worked at `/`: a **“Forbidden: cross-site request blocked”** banner appeared, including under PC shell approvals. Mind built-in MCP loaded as enabled with 5 tools; local list/search tools and delegate were available, while web search, browser, Gmail, and Model were unavailable. No browser sessions were listed.
- `https://adrians-mind.vercel.app/voice` — Page not found. On Chat, Voice status is Browser speech (not realtime); a visible notice says “Sign in to use voice and connected services.” No login attempted.
- `https://adrians-mind.vercel.app/activity` — Page not found. Chat’s Recent Activity panel showed five `forbidden_cross_site` entries (latest Nov 7, 1:19 AM in the final capture). On one intermediate return to Chat it briefly showed “No activity yet” before repopulating.
- `https://adrians-mind.vercel.app/` — Chat workspace painted. Memory OFF; database status changed from Checking to Remote configured (with “No restart test was run against that host”); Voice Browser speech; REA Partial; HP Not paired. Header said “Grok configured”; details said “Grok: Configured. Checked Nov 7, 1:20 AM. No dedicated project yet. The free organization already holds two active projects.” No message was sent.

## Primary-control checks
- Sidebar Library, Projects, Scheduled, and Explore were clicked once and each rendered as described; in-app navigation works while several corresponding direct deep links return Page not found.
- Dashboard Filters and Dive to city were attempted; each timed out while scrolling the dashboard into view and did not visibly activate. Operator also timed out. These match the known intermittent click timeouts.
- Tools panel was opened from Chat for inspection; no tool, retry, send, schedule, or other state-changing action was run.

## Known-list comparison
- Universe hang was transient: loading text cleared and the 3D scene painted.
- `forbidden_cross_site` / Tools Forbidden, Explore TEMPLATE/NOT LIVE, local-only Scheduled worker and empty Memory are present as known.
- Direct deep-link 404s are present for Library, Projects, Scheduled, Tools, Voice, and Activity; SPA sidebar navigation succeeds for Library, Projects, Scheduled, and Explore.
- No NEW symptom identified beyond the supplied known list.

## Captures
- `01-dashboard.png`
- `02-library.png`
- `03-projects.png`
- `04-scheduled.png`
- `05-explore.png`
- `06-memory.png`
- `07-tools.png` (direct `/tools` 404)
- `08-voice.png` (direct `/voice` 404)
- `09-activity.png` (direct `/activity` 404)
- `10-chat.png`
- `11-tools.png` (in-app Tools panel, with Forbidden banners)
