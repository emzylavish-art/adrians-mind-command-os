# REA internal visual walk — 2026-11-07aq

Read-only, unsigned pass. No sign-in forms, credentials, or action buttons that create/edit/send were used. The app remained signed out; settings/status and navigation panels were inspected only.

## URL → observation

- `https://adrians-mind.vercel.app/dashboard` — First paint showed **“Painting the universe…”** (captured separately). During the requested ~5 s wait it resolved to the universe map rather than remaining stuck. Final scene showed nodes/cards. Side cards: **Notion Galaxy — Unavailable** (no snapshot/token), **Money — no spend source yet**, **Fleet Plan — Queue unavailable** (painter/light/motion idle), **Time — Live** (no git/lock history). Feed showed 4 events (three landing statuses and a Merge Gate item). No login bounce or “Something went wrong”.
- `https://adrians-mind.vercel.app/` — Command/chat home rendered. Sidebar: Library, Projects, Scheduled, Explore; profile/settings control. Header initially said **Checking**, then changed to **Grok configured**. Recent Activity showed repeated `forbidden_cross_site` records (“Forbidden: cross-site request blocked”). Memory is off; no device projects; voice is browser speech, REA partial, HP not paired. System status later reported database **Remote configured** and Grok checked/configured.
- `https://adrians-mind.vercel.app/memory` — Memory manager rendered with no saved notes. Describes global/project/chat scopes; this page can save global notes only. No note was added.
- `https://adrians-mind.vercel.app/explore` — Persona directory rendered with built-in cards marked **TEMPLATE / NOT LIVE**; cards are explicitly not live Poe/Character.AI bots. Categories showed Official 10, Assistant 6, Search 1, Programming 2, Image 1, Video/Audio/Budget/My agents 0. No template was saved.
- Sidebar **Library** — Empty text-copy library (“No files yet”); upload/Drive controls visible but not used.
- Sidebar **Projects** — No on-device projects. Two external project labels appear, with explicit text that their tasks/files/progress are not read. No project was opened or created.
- Sidebar **Scheduled** — “Checking the worker…” remained visible; no schedules yet. UI describes local scheduling, not hosted scheduling. Add/run controls were not used.
- Settings → **Activity** — Repeated historical `forbidden_cross_site` entries (“Forbidden: cross-site request blocked”), spanning Nov 6–7; newest visible entry was Nov 7, 3:24 AM. The list is long and recurring.
- Settings → **Tools** — Local project/chat/note reads are listed available. Web search, browser, Gmail, and model are not available. PC shell approvals and MCP sections displayed loading placeholders. No tools were run.
- Settings → **Safe Keys** — No secret values or inputs are present. The page says secure authenticated storage and per-capability status are unverified and says not to treat the inventory as evidence of configuration. Voice/Chat/Image/Video/Code/GPT all show **Not connected — configuration unavailable**.
- Settings → **Chat** — Returns to the normal Command/chat home. This is an in-app view, not a separate deep-link route.
- Direct deep links `https://adrians-mind.vercel.app/chat`, `/activity`, `/tools`, `/voice` — Each returned the app’s **Page not found** view (“That address does not match a page in this workspace”). In-app Settings navigation does reach Chat, Activity, and Tools; no dedicated Voice page was found.

## Findings

### Matches to the known watchlist
- Universe briefly displayed the painting state, then rendered; it was not persistently hung in this pass.
- Explore remains template-only / not live.
- The four direct deep links above return Page not found.
- `forbidden_cross_site` remains recurrent in Activity and Recent Activity.
- Grok’s configured status is accompanied by a caveat that a live reply was not verified.

### New candidates from this pass (baseline comparison needed)
- Status surfaces disagree: the header says **Grok configured** and Integrations says **Grok chat — Configured** (server key present; live reply unverified), while Safe Keys says **Chat — Not connected / configuration unavailable**. Safe Keys explicitly disclaims verified configuration, so this is a UI/status inconsistency, not evidence that a key is absent or present.
- Scheduled still showed **Checking the worker…** alongside “No schedules yet”; Tools showed loading placeholders for PC shell approvals/MCP sections. These may be transient, but were still visible in the captured pass.

## Captures

- `01-dashboard.png` — resolved universe/dashboard
- `02-home.png` — Command/chat home
- `03-memory.png` — Memory manager
- `04-explore.png` — Explore directory
- `05-library.png`, `06-projects.png`, `07-scheduled.png` — sidebar views
- `08-activity.png`, `09-tools.png`, `10-settings-safe-keys.png` — status/system views
- `11-deep-link-404.png` — custom Page not found screen
- `12-dashboard-initial-painting.png` — initial “Painting the universe…” screen
- `13-home-initial.png` — earlier home capture before status settled
