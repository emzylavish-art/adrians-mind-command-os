# Adrian's Mind visual walk — pass 2026-11-07ac

Read-only walk completed on 2026-11-07. No login/password attempts, form submissions, or state-changing actions were made.

## URLs visited and results

- `https://adrians-mind.vercel.app/dashboard` — Initially showed “Painting the universe…”, then the Universe canvas painted with bot labels and side panels. It did not bounce to `/login`. Visible status: 18 idle bots, no active claims.
- `https://adrians-mind.vercel.app/` — Home/Command rendered with sidebar. Sidebar entries Library, Projects, Scheduled, Explore were reachable. Initial header/system status said “Checking” / “Grok: Checking. Checked . Checking isolation.” Recent Activity showed five `forbidden_cross_site` rows. Active Projects was empty.
- Sidebar Library — Rendered. “Grok configured” appeared in header. Text copies panel said “No files yet.”
- Sidebar Projects — Rendered. “Grok configured” appeared in header. No on-device projects; two external entries were marked unchanged and explicitly outside this app.
- Sidebar Scheduled — Rendered. “Grok configured” appeared in header. “No worker process is running”; nothing runs in background; database is local/not hosted scheduling. No schedules yet.
- `https://adrians-mind.vercel.app/explore` — Rendered Persona directory. Templates are explicitly labeled `TEMPLATE` / `NOT LIVE`; page says they are local built-ins, not live Poe or Character.AI bots.
- `https://adrians-mind.vercel.app/memory` — Rendered Memory manager; no saved memory yet.
- Direct `/library`, `/projects`, `/scheduled`, `/chat`, `/activity`, `/tools`, `/voice` — Each returned the app’s “Page not found” screen when opened directly. The first three work when entered through sidebar buttons from `/`.

## Visual findings

- Universe: painted after an initial loader; not a persistent hang on this pass. Cards: Notion galaxy unavailable (no snapshot/token); Money has no spend source; Fleet plan queue unavailable (painter/light/motion idle); Time has no git/lock history. No-data chart panels were also visible.
- Grok status differs by view: home initially showed Checking, while Library/Projects/Scheduled showed “Grok configured.” This matches the known Grok honesty/status mismatch.
- Recent Activity on home: five visible `forbidden_cross_site` entries, matching the known symptom.
- Explore and Scheduled states match known `TEMPLATE / NOT LIVE` and no-worker findings.
- New/potential symptom: the visible Dashboard “Dive to city” control timed out on two click attempts without changing the view. No other new symptom was identified; the empty panels and direct deep-link 404s align with the known list.
- Dashboard had an “Interior” panel stating building data unavailable; no login page appeared.

## Captures

- `01-dashboard.png` — painted Universe
- `04-explore.png` — Explore templates
- `05-memory.png` — Memory manager
- `06-library.png` — Library empty state
- `07-projects.png` — Projects empty state
- `08-scheduled.png` — Scheduled no-worker state
- `09-home.png` — Command home and status/activity panels
