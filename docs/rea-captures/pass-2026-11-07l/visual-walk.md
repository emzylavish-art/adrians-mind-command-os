# REA internal visual walk — Adrian's Mind — 2026-11-07l

Read-only pass. Password login was **not attempted** (the audit secret domain is still `example.com`); used only the browser session already present. No settings were changed, no forms submitted, no sign-in attempted, and no account credentials entered.

## Walk observations

- **Dashboard / Universe** — Opened `https://adrians-mind.vercel.app/dashboard`; final URL stayed `/dashboard`. No Access denied, login page, or login bounce; dashboard/Universe chrome rendered. Initially showed “Painting the universe…”. Within the ~20-second wait it cleared and the 3D scene painted with labeled bot nodes. Three landing chips remained `light/motion/painter pending · no hops reached`. Panels showed Notion unavailable (no snapshot/token), no spend source, fleet queue unavailable, quiet void (18 idle/no active claims), no git/lock history, and an interior message “Building data unavailable.” **Screenshot:** `01-dashboard.png`.
- **Memory (direct)** — Opened `https://adrians-mind.vercel.app/memory`; final URL `/memory`. Memory manager loaded; no saved memory/notes. Page explains local scopes and offers add/search controls; left unchanged. **Screenshot:** `02-memory.png`.
- **Explore** — Opened `https://adrians-mind.vercel.app/explore`, then also reached it via the sidebar link; final URL `/explore`. Persona directory rendered local built-in templates, labeled TEMPLATE / NOT LIVE; no saved agents. No template was selected or saved. **Screenshot:** `03-explore.png`.
- **Library** — Clicked sidebar Library; final URL `/` (in-app view). Loaded with no files/text copies; Upload text and Browse Drive controls visible, not used. **Screenshot:** `04-library.png`.
- **Projects** — Clicked sidebar Projects; final URL `/`. No on-device projects. Two external labels (Oak Bridge Capital, BridgePoint) shown unchanged; no external tasks/files/progress read. **Screenshot:** `05-projects.png`.
- **Scheduled** — Clicked sidebar Scheduled; final URL `/`. No schedules. Worker status was checking; page notes the database is local and not hosted scheduling. Add/run controls were not used. **Screenshot:** `06-scheduled.png`.
- **Settings** — Opened via profile/settings control; final URL `/`. Settings and workspace navigation rendered; no preference changed. In-app header chip read `Grok configured`. **Screenshot:** `07-settings.png`.
- **Connected** — Opened through Settings workspace navigation; final URL `/`. Grok card says `KEY PRESENT` but explicitly not live-verified. Notion/GitHub/Gmail/Drive/Calendar/Slack showed not connected/checking; other model/search providers were unconfigured; voice not realtime; MCP not connected; local computer not paired. No setup/test/save action taken. **Screenshot:** `08-connected.png`.
- **Tools** — Opened through Settings workspace navigation; final URL `/`. Local list-projects/list-chats/search-notes and delegate were available; web search, browser, Gmail, model unavailable. PC-shell approvals/MCP lists were still loading; no browser sessions yet. Did not press Open page or approve anything. **Screenshot:** `09-tools.png`.
- **Activity** — Opened through Settings workspace navigation; final URL `/`. A top banner said `Forbidden: cross-site request blocked`; the activity list showed many repeated `forbidden_cross_site` events (latest displayed Nov 6, 9:05 PM, earlier events back through the evening). Did not retry, view log, or dismiss. This reproduces the known cross-site isolation symptom. **Screenshot:** `10-activity.png`.
- **Memory (in-app)** — Opened through Settings workspace navigation; final URL `/`. Memory status `OFF`, 0 stored items, no saved memory. A `Forbidden: cross-site request blocked` banner was visible above the page. No enable/save control used. **Screenshot:** `11-memory-in-app.png`.
- **Safe Keys** — Visible within Settings; final URL `/`. Inventory says configuration status is unverified and no secret values are displayed/accepted/copied/revealed. Voice, Chat, Image, Video, Code, and GPT all read `NOT CONNECTED — CONFIGURATION UNAVAILABLE`; specifically, Safe Keys Chat is not connected/configuration unavailable. **Screenshot:** `12-safe-keys.png`.
- **Voice** — No separate Voice sidebar/workspace control was present. Settings embeds voice preferences; final URL `/`. Voice is saved locally and “not used until live voice is connected”; no speech provider is called, and the settings say they do not start the microphone. **Screenshot:** `13-voice-settings.png`.
- **Artifacts / Canvas** — No separate artifact/canvas navigation item appeared. The visual canvas is the painted Universe on `/dashboard`. Direct checks of `/artifacts` and `/canvas` returned the app’s Page not found screen; no content/action opened. `/voice` likewise returned Page not found.

## Status / gaps

- **Access/login:** `/dashboard` rendered dashboard chrome; no Access denied and no login bounce. The home view did show a sign-in prompt for voice/connected services, but it was not followed.
- **Universe:** painted with labeled nodes after the initial painting message cleared; not hung.
- **Grok status:** standalone Dashboard, Memory, and Explore do not show the standard Grok header chip. In-app workspace views generally show `Grok configured`; the home System Status text separately showed `Grok: Checking…` / isolation checking. Connected’s Grok card is only `KEY PRESENT`, not live-verified. Safe Keys Chat remains not connected/configuration unavailable.
- **New vs known:** no distinct new symptom established. Repeated `forbidden_cross_site` events and the Activity/Memory banner match the known cross-site isolation gap. Dashboard data panels remain partly unavailable/empty as noted above.

## Screenshots

All saved in `/workspace/rea-captures/pass-2026-11-07l/`: `01-dashboard.png` through `13-voice-settings.png`.
