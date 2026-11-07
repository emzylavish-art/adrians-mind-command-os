# Adrian’s Mind visual walk — pass 2026-11-07ad

Read-only browser walk; no password login was attempted, and no Zack/Waters account was used. No content was created, saved, or sent. App is reachable without signing in for these views.

## Summary
- **Universe:** `/dashboard` first showed “Painting the universe…” then painted successfully in about 4.4 seconds after the first post-load check. A second visit also rendered the 3D scene; no prolonged paint hang this pass.
- **Header:** Chat initially showed **Checking**; later workspace pages showed **Grok configured**. Connected lists Grok as **Key present** but explicitly not live-verified. Settings → Safe Keys reports Voice, Chat, Image, Video, Code, and GPT all **Not connected — configuration unavailable**. This is the known Grok/Safe Keys mismatch.
- **New/unlisted issue:** the dashboard **Filters** button did not open after three click approaches (normal, forced, and accessibility-ref click); each timed out, and no panel appeared. No visible bot wall or error message. Reported the interaction refusal. No Access denied page or other explicit auth refusal appeared. No other confirmed new regression versus the standing gaps supplied. Dashboard also shows absent data sources described below; without a prior capture I cannot call those new.

## Views
- **`/dashboard`** — 18 agents listed idle; Fleet plan “Queue unavailable”; Notion galaxy/mirror unavailable (“No Notion snapshot file found and NOTION_TOKEN unset”); Money has no spend source; charts mostly “No data yet”; timeline says no git/lock history; interior says building data unavailable. Scene painted successfully. Filters click failed as above.
- **`/` Chat/Home** — workspace UI loads. Active Projects says no projects; Chat composer and local mode/effort controls render; a banner says “Sign in to use voice and connected services.” Header status starts Checking then becomes Grok configured. “View all” opens Activity.
- **`/memory`** — Memory manager loads, no saved memory; project/chat scopes disabled until an owner is selected. Did not save a note.
- **`/explore`** — persona directory renders local templates marked **TEMPLATE / NOT LIVE**. Category tabs filter successfully; Video, Audio, Budget, and My agents show no results. Save/open actions were not used.
- **Library (sidebar)** — panel works; no files yet and no file selected. Upload text and Browse Drive were left untouched. Direct `/library` instead shows generic Page not found.
- **Projects (sidebar)** — panel works: 0 local projects; 2 external labels (Oak Bridge Capital, BridgePoint), with no tasks/files/progress read. Opened and cancelled the empty New Project dialog without creating anything. Direct `/projects` shows Page not found.
- **Scheduled (sidebar)** — initially “Checking the worker…”; then “No worker process is running. Schedules stay saved. Nothing is running in the background.” No schedules yet. Add/Run actions were not used. Direct `/scheduled` shows Page not found.
- **Activity (Home → View all)** — dozens of repeated `forbidden_cross_site` rows, each “Forbidden: cross-site request blocked”; latest visible entries are Nov 7 12:07 AM. This matches the known Activity gap.
- **Connected / Safe Keys / Tools** — reached via Settings navigation. Connected shows Grok key present (not live verified); Notion/GitHub/Gmail/Drive/Calendar/Slack not connected or checking; other model/search providers not configured; MCP not connected and local computer not paired. Safe Keys statuses are all not connected/configuration unavailable. Tools marks List projects, List chats, Search notes, and Delegate available; Web search, Browser, Gmail read/send, and Model unavailable.

Direct `/library`, `/projects`, and `/scheduled` return Page not found, but their sidebar controls open the corresponding views; not counted as a confirmed regression without a prior baseline.

## Screenshots
`01-dashboard.png`, `02-home-chat.png`, `03-memory.png`, `04-explore.png`, `05-library.png`, `06-projects.png`, `07-scheduled.png`, `08-activity.png`, `09-connected.png`, `10-settings-safe-keys.png`, `11-tools.png`, `12-direct-routes-404.png`, `13-project-create-modal.png`, `14-scheduled-initial-check.png`, `15-settings-full-page.png`.
