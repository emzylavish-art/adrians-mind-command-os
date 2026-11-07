# Adrian's Mind — read-only visual walk

Date: 2026-11-07 (UTC+1)
Base: https://adrians-mind.vercel.app

## Session / dashboard
- `/dashboard` loaded directly; no redirect to `/login`, no “Something went wrong”, and no Access denied. The “Painting the universe…” loader cleared within the 20-second wait. The dark starfield / bot scene rendered (paint: **yes**).
- Root `/` presents the local “Adrian (Personal)” workspace and a “Sign in to use voice and connected services” notice/link to `/login`; treated this browser as **unsigned**. No sign-in form was opened and no credentials were entered.
- Dashboard canvas/list shows 18 idle bots; light, motion, and painter are “pending · no hops reached”. Panels: Notion Galaxy unavailable (`unavailable — No Notion snapshot file found and NOTION_TOKEN unset.`); Money `no spend source yet`; Fleet Plan `Queue unavailable`; System Weather `Quiet void` / `18 idle · no active claims`; timeline `No git/lock history on box yet.`; several charts have `no source yet`; interior says `Building data unavailable (it may have left the city on the last refresh).`

## Views and URL outcomes
- `/memory` — loads. Memory manager says “No saved memory yet”; only global note can be added here, project/chat scopes disabled pending an owner. No note was added.
- `/explore` — loads. Category tabs work (All, Official10, Assistant6, Search1, Programming2, Image1, Video0, Audio0, Budget0, My agents0). Built-in cards are labeled `TEMPLATE` / `NOT LIVE`; My agents is empty; Video/Audio/Budget categories show no local personas. The page says selected-agent handoff is not verified. No “Save and open Chat” action was used.
- Library — in-app sidebar button opens Library; no files yet. `/library` directly is a “Page not found” page. Upload text / Browse Drive were not activated.
- Projects — in-app sidebar opens Projects; 0 on this device, External (2) · unchanged (Oak Bridge Capital and BridgePoint); no tasks/files/progress are read. `/projects` directly is “Page not found”. No project was created.
- Scheduled — in-app sidebar opens Scheduled; no schedules. After its worker check, exact status: `No worker process is running. Schedules stay saved. Nothing is running in the background. This database is local. It is not hosted scheduling.` `/scheduled` directly is “Page not found”. No job was added or run.
- Activity — available from Settings’ Systems navigation; it shows repeated `forbidden_cross_site` entries with `Forbidden: cross-site request blocked`. `/activity` directly is “Page not found”. Count observed during this pass: 126 such entries; newest visible time Nov 6, 7:26 PM (app-local).
- Settings — opened from the profile control (no standalone route); Safe Keys shows Voice, Chat, Image, Video, Code, and GPT all `NOT CONNECTED — CONFIGURATION UNAVAILABLE`. It says no input/reveal/copy/save action is available. Direct `/settings` is “Page not found”.
- Skills — Settings → Systems → Skills works. Project list, Chat list, and Note search are On, each reporting `None. It reads this browser.` Notion, Cloud browser, Voice, and Gmail are NOT INSTALLED. A `Forbidden: cross-site request blocked` alert is visible. Direct `/skills` is “Page not found”. No skill was run/toggled and no draft was saved.
- Tools — Settings → Systems → Tools works. List projects/chats/search notes and Delegate show Available; Web search, Browser, Gmail read/send, and Model show Not available. PC shell approvals failed with `Forbidden: cross-site request blocked`; MCP servers subsequently rendered (Mind built-in, Enabled, 5 tools). Direct `/tools` is “Page not found”. No page was opened and no tool was run.
- Direct `/scheduled`, `/activity`, `/projects`, `/library`, `/settings`, `/skills`, and `/tools` all render the same not-found message: `That address does not match a page in this workspace.` In-app navigation reaches the applicable panels.
- Header voice-mode control was toggled Orchestrator → Direct → Orchestrator to inspect it; it did not start a microphone/realtime session. No sign-in or “Speak” activation.

## Broken / missing and comparison
- Reproduced established gaps: `forbidden_cross_site`, no Scheduled worker, Safe Keys not connected, Explore templates not live, and empty/unavailable Universe data panels. No Access denied, login bounce, captcha, or new hard load failure observed.
- Possible UI inconsistency: the main header displayed `Grok configured`, while Safe Keys → Chat displayed `NOT CONNECTED — CONFIGURATION UNAVAILABLE`; the root status also briefly displayed `Grok: Checking. Checked . Checking isolation.` This is a visual mismatch, not a credential/configuration test.
- Read-only caveat: no explicit save/create/run actions were taken. The app itself records failed cross-site requests in Activity; its browser-storage indicator rose from 22.1 KB at the start to 22.5 KB during the walk.

## Screenshots
Browser screenshots were captured as tool-managed image attachments, but those image files were not accessible to the box Shell filesystem for copying (`cp: cannot stat ...`). Therefore no PNGs could be saved under this directory; the requested screenshots were not available as ordinary `/workspace` files.
