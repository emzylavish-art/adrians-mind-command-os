# Adrian's Mind — read-only visual walk (2026-11-07)

## Scope and captures
- Read-only inspection; no sign-in attempted, no account credentials used, and no forms submitted or settings changed.
- PNGs: `01-dashboard.png`, `02-memory.png`, `03-explore.png`, `04-chat-home.png`, `05-activity.png`, `06-tools.png`.
- Universe/3D: **Yes.** `/dashboard` first showed “Painting the universe…”; within the wait it rendered a starfield/3D constellation with agent nodes. It did not remain on the loader.

## Direct URLs
- `/dashboard` — final URL `https://adrians-mind.vercel.app/dashboard`. 3D painted; 18 agents listed idle / “Quiet void”. Notion galaxy/mirror unavailable (no snapshot/token); fleet queue unavailable; spend and most charts have no source/data; lanes showed pending/no hops; interior said building data unavailable. No “Something went wrong” banner and no redirect to `/login`.
- `/memory` — final URL `https://adrians-mind.vercel.app/memory`. Memory manager rendered, with “No saved memory yet”; global note form available; project/chat scopes disabled pending owner selection. No saved notes.
- `/explore` — final URL `https://adrians-mind.vercel.app/explore`. Persona directory rendered with 10 local templates marked template/not live; page notes selected-agent handoff is not yet verified. No live remote personas.
- `/` — final URL `https://adrians-mind.vercel.app/`. Chat home rendered. Initial status was Checking; it settled to Grok configured. Chat home showed memory OFF, no local projects/activity initially, database “Remote configured,” Voice “Browser speech,” REA “Partial,” HP “Not paired,” and a Grok status saying configured (not evidence of a live model call). A sign-in link was visible for voice/connected services, but no login was attempted.

## Sidebar and reachable workspace controls (all views stayed at `/` unless noted)
- Library — empty text-copy list (“No files yet”); upload/Browse Drive controls present. Header showed Grok configured.
- Projects — 0 on-device projects; two external labels explicitly marked unchanged/separate; no tasks/files/progress read.
- Scheduled — no schedules yet; page indicated the worker is not running. Add/run controls were left untouched.
- Settings — browser-local preferences. **Safe Keys** listed Voice, Chat, Image, Video, Code, and GPT as “Not connected — configuration unavailable”; it explicitly says storage/configuration status has not been verified and offers no reveal/save action. Contrast: Connected and the app header showed Grok “Key present” / “Grok configured”, with the page caveat that this is not a live-verified integration.
- Activity — numerous repeated `forbidden_cross_site` entries, each described “Forbidden: cross-site request blocked” (entries spanning Nov 6–7). This is the main recurring broken condition; no 404 was observed.
- Tools — list projects/chats/search notes marked available; web search, browser, Gmail read/send, and model marked unavailable; delegate available. PC shell approvals and MCP panels initially showed loading.
- Bots & Agents — visible `Forbidden: cross-site request blocked` alert; no agents and no REA report; bounded planner not running. No actions launched.
- Build — “No paired PC agent is online” / “Not paired”; repo editing and terminal execution unavailable. No build started.
- Research — search provider not configured; no citations; page says it refuses rather than calling Grok.
- Runs — no runs yet; no run queued.
- Connected — Grok “Key present” (not live-verified); Notion, GitHub, Gmail, Drive, Calendar, Slack and MCP not connected/checking; OpenAI/Claude/Gemini/OpenRouter and web search not configured; Voice not realtime; local computer not paired.
- Skills — local project/chat/note read skills on, but each reports no local content; Notion/cloud browser/voice/Gmail skills not installed.
- Memory view — OFF, 0 stored items, 0 B; no saved memory.
- Help — rendered at `/`; described the UI pictures as layout rather than live data and noted that Build requires a paired computer.
- Dashboard link — opened directly at `/dashboard` as above. Sidebar also exposed Chat, Explore, Settings, and a floating Speak control; Voice status throughout said browser speech, not a realtime session. No Speak action or microphone session was started.

## Findings
- **Universe painted: YES**, after a short initial loader.
- Broken: repeated cross-site request blocks (`forbidden_cross_site`) in Activity and a visible refusal alert in Bots & Agents/other app views.
- Missing/empty: no local projects, saved memory, scheduled jobs, runs, Library files, Notion snapshot, working worker, configured research provider/citations, realtime voice, paired PC, or connected Safe Keys capabilities.
- No 404s encountered. All observed secondary workspace panels rendered at `/`; only the three requested content pages and dashboard used their direct paths.
