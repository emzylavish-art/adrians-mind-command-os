# Adrian's Mind — read-only visual walk (2026-11-07)

- Scope: signed-out visual audit only. No email or password entered; no sign-in attempted. No data-changing form/action was submitted. The New Project dialog was opened and canceled without saving.

## Findings

- **Dashboard / Universe — `https://adrians-mind.vercel.app/dashboard`:** stayed on `/dashboard`; did not redirect to `/login`; no “Something went wrong” screen. Each load briefly showed “Painting the universe…” and then cleared (about 15 seconds on the second visit). The 3D star scene painted; 18 bots were idle and there were no active claims. The Universe is not permanently hung on Painting.
- **Signed-out chrome:** the main app shows a local “Adrian (Personal)” profile and browser-only storage, but also “Sign in to use voice and connected services” with a Sign in button. No sign-in was performed. Dashboard/Memory/Explore are reachable while signed out.
- **Grok vs Safe Keys:** after its initial “Checking” state, the main header showed **Grok configured**; Home System Status said “Grok: Configured. Checked Nov 7, 5:15 AM.” Connected showed “Grok — KEY PRESENT,” but cautioned it is not live-verified. Settings → Safe Keys instead showed Voice, Chat, Image, Video, Code, and GPT all **NOT CONNECTED — CONFIGURATION UNAVAILABLE**; it explicitly says secure storage and per-capability status were not verified. This is a visible status mismatch, not proof of a working integration.
- **Universe data gaps:** Notion galaxy unavailable (no snapshot / `NOTION_TOKEN` unset); Money has no spend source; Fleet plan queue unavailable; commit, lock-history and spend charts have no data; “No git/lock history on box yet.” Feed had four events (light/motion/painter pending, no hops reached, and Merge Gate). An Interior panel reports “Building data unavailable (it may have left the city on the last refresh).”
- **Activity / PC shell:** Activity contains many repeated `forbidden_cross_site` records (“Forbidden: cross-site request blocked”), spanning roughly 3:59–5:14 AM. Tools’ PC shell approvals also show “Forbidden: cross-site request blocked” and Retry. Browser console showed repeated HTTP 403s for `/api/mind/pc/status` and `/api/mind/pc/approvals`. The Tools page otherwise shows local project/chat/note reads available; web search, browser, Gmail, and model unavailable; Mind built-in MCP enabled with five tools, and no browser sessions.
- **Additional console/UI issue:** browser console also logged repeated 404s for route-like paths `/chat`, `/tools`, `/voice`, `/activity`, `/library`, `/projects`, `/scheduled`, `/settings`, and `/safe-keys` while the corresponding client-side views still rendered under `/`. This may indicate route/prefetch requests failing even though the SPA view appears.
- **Memory — `https://adrians-mind.vercel.app/memory`:** page loads; “No saved memory yet.” No note was added.
- **Explore — `https://adrians-mind.vercel.app/explore`:** page loads. Built-in persona cards are explicitly marked **TEMPLATE / NOT LIVE**. Category counts displayed Official 10, Assistant 6, Search 1, Programming 2, Image 1, Video 0, Audio 0, Budget 0, My agents 0. The category filters were exercised; My agents is empty. Save-and-open actions were not used.
- **Scheduled — app view at `/`:** “No worker process is running. Schedules stay saved. Nothing is running in the background. This database is local. It is not hosted scheduling.” No schedules yet. Add daily job / Run due schedules were not used.
- **Other app views at `/`:** Library has no files; Projects has no on-device projects and shows two external labels as unchanged; Agent Runs has no runs; Build says no paired PC agent and repository edits/terminal/tests are unavailable; Skills shows local project/chat/note skills On but no local items, with Notion, cloud browser, voice, and Gmail not installed. These were inspected without running jobs or changing settings.
- **Dashboard control check:** Filters and Dive-to-city controls, plus a Conductor row, were exposed in the accessibility tree. Browser clicks on Filters/Dive/Conductor timed out despite the elements resolving; a desktop click on the visible Conductor label did not visibly open details. Potential dashboard hit-target/interaction issue; not enough to attribute beyond this pass.
- **Read-only controls exercised:** Explore category tabs, Back to Chat, Search workspace palette, Alerts, and a New Project dialog (canceled). No schedule, worker, REA, agent, send, save, or sign-in action was run.

## Major navigation URLs

- Dashboard / Universe: `https://adrians-mind.vercel.app/dashboard`
- Memory: `https://adrians-mind.vercel.app/memory`
- Explore: `https://adrians-mind.vercel.app/explore`
- Chat home and client-side views Library, Projects, Scheduled, Settings, Connected, Tools, Activity, Bots & Agents, Build, Research, Runs, Skills: `https://adrians-mind.vercel.app/` (the displayed view changed while the SPA URL remained `/`)
- Final page left open: `https://adrians-mind.vercel.app/dashboard`

## Screenshots

All PNGs are in `/workspace/rea-captures/pass-2026-11-07ba/`:

- `01-dashboard-painting.png` — initial Painting overlay
- `02-dashboard-universe-painted.png` — painted Universe
- `03-memory-empty.png`
- `04-explore-templates.png`
- `05-explore-my-agents-empty.png`
- `06-chat-home-signed-out.png`
- `07-scheduled-no-jobs.png`
- `08-library-empty.png`
- `09-project-create-modal.png` — canceled, not saved
- `10-settings-overview.png`
- `11-activity-forbidden-cross-site.png`
- `12-tools-and-pc-shell.png`
- `13-tools-pc-shell-forbidden.png`
- `14-connected-status.png`
- `15-agents-no-report.png`
- `16-build-not-paired.png`
- `17-research-unconfigured.png`
- `18-agent-runs-empty.png`
- `19-skills-uninstalled.png`
- `20-alerts-forbidden-events.png`
- `21-dashboard-universe-painted-after-wait.png`
