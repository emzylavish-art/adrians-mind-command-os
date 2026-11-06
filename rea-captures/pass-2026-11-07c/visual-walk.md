# Adrian's Mind — visual walk (2026-11-07)

## URLs visited
- https://adrians-mind.vercel.app/dashboard
- https://adrians-mind.vercel.app/memory
- https://adrians-mind.vercel.app/explore
- https://adrians-mind.vercel.app/ (home; sidebar opened Library, Projects, Scheduled, Settings, and Search)

## What rendered
- **Dashboard:** page title `Adrian's Mind · Universe`; nearly all-black screen with a small centered `Painting the universe…` loader and close button. No Universe canvas or dashboard panels appeared in the capture. It did not redirect to `/login` or show `Something went wrong`, so the conditional retry was not triggered.
- **Home/sidebar:** Chat landing UI rendered with Library, Projects, Scheduled, Explore, Search, and Settings. Active projects were empty; home status showed Database `Checking`, Voice `Browser speech`, REA `Partial`, HP `Not paired`; Recent Activity displayed repeated `forbidden_cross_site` entries. Search workspace opened a Go to palette from its button. The header advertises `⌘K`; the keypress itself was not tested.
- **Library:** no files; upload text and Browse Drive controls shown.
- **Projects:** zero on-device projects; Oak Bridge Capital and BridgePoint are labeled external and unchanged.
- **Scheduled:** no schedules; page says local database/not hosted scheduling and remains `Checking the worker…`.
- **Memory:** Memory manager rendered with add-note and search controls, only global scope available (project/chat scopes disabled without an owner), and `No saved memory yet.`
- **Explore:** Persona directory with category tabs and ten built-in cards. Cards are marked `TEMPLATE` / `NOT LIVE`; page says these are local templates, not live Poe/Character.AI personas, and selected-agent handoff is unverified. No templates were activated.
- **Settings (within home):** voice controls are local-only; Safe Keys lists Voice, Chat, Image, Video, Code, and GPT as `NOT CONNECTED — CONFIGURATION UNAVAILABLE`. Requirement notes say image/video studios are not called and full-duplex voice/turn-taking was not built or tested.

## Broken / missing / limited surfaces
- Universe canvas did not render; only its loading message was visible.
- No Voice Cloning Studio or Artifacts/Canvas surface was observed on the walked pages. Voice settings are local presets/activation/speed only; the page says no speech provider is called.
- Model selection is limited to a header menu with Auto, Fast, Expert, Heavy, and Build (described as Grok model routing); no named-provider/model picker was visible.
- `⌘K` is shown beside Search and the Search button opens a workspace navigation palette; keyboard shortcut operation remains unverified.
- Activity contains repeated `forbidden_cross_site` entries; database and scheduled-worker status were still checking during the walk.

## Session state
No sign-in flow was opened and no credentials were entered. No login redirect appeared. The app showed a local `Adrian (Personal)` profile, but also displayed `Sign in to use voice and connected services`; authenticated-owner status is therefore not confirmed, and connected services appeared unavailable.

## Captures
- `01-dashboard.png`
- `02-memory.png`
- `03-explore.png`
