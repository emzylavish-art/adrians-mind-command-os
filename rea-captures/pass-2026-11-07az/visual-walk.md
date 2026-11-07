# Adrian's Mind — read-only visual walk (2026-11-07)

## Routes and captures
- Dashboard: `https://adrians-mind.vercel.app/dashboard` — final URL remained `/dashboard`; no `/login` bounce. See `01-dashboard.png`.
- Memory: `https://adrians-mind.vercel.app/memory` — final URL `/memory`. See `02-memory.png`.
- Explore: `https://adrians-mind.vercel.app/explore` — final URL `/explore`. See `03-explore.png`.
- Chat/home, Library, Projects, Scheduled, Tools, Activity, and Settings are in-app views and stayed at `/`; captures are `04-chat.png` through `10-safe-keys.png`.
- No passwords, secrets, or account sign-ins were attempted. A home-page banner says sign-in is needed for voice and connected services. No dedicated Voice sidebar view was present; voice status/settings were visible in Chat and Settings.

## What rendered / state
- **Universe:** The initial dashboard render showed “Painting the universe…”. It resolved after a delay to a visible dark 3D constellation with named bot nodes and side panels. On a later dashboard visit it again showed the painting state before resolving, so the delay/intermittent hang remains observable. Final capture is painted, not stuck. Light, motion, and painter each showed “pending · no hops reached”; the dashboard status says 18 idle and no active claims.
- **Dashboard panels:** Notion galaxy unavailable (“No Notion snapshot file found and NOTION_TOKEN unset”); Money has no spend source; Fleet plan queue unavailable with painter/light/motion idle; system weather is “Quiet void.” Commit, lock-history, and spend charts show no data/source. These panels render but are empty/unavailable.
- **Grok header vs Safe Keys:** After its initial “Checking” state, the workspace header settled to **“Grok configured”**; System Status then said “Grok: Configured” and reported a check time. Settings → Safe Keys instead showed **“Not connected — configuration unavailable”** for Voice, Chat, Image, Video, Code, and GPT, and explicitly says secure storage/per-capability status are unverified. No secret values or key controls were exposed. This is the known Grok-status/honesty mismatch.
- **Activity:** Activity view rendered a large list; snapshot contained 200 `forbidden_cross_site` entries. Visible rows say “Forbidden: cross-site request blocked” (first visible entry Nov 7, 4:53 AM). The same refusal appeared in the Tools view’s PC shell approvals area and as a banner; this is the known `forbidden_cross_site` symptom on an additional surface.
- **Memory:** Empty — “No saved memory yet.”
- **Explore:** Built-in local personas only; cards are labelled **TEMPLATE / Not live**, and explanatory copy says they are not live Poe/Character.AI bots. No live personas appeared.
- **Scheduled:** Rendered with “No worker process is running. Schedules stay saved. Nothing is running in the background. This database is local. It is not hosted scheduling.” No schedules are present. Matches the known no-worker state.
- **Tools:** Local project/chat/note reads and delegate are shown available. Web search, browser, Gmail read/send, and model are unavailable. The loading placeholders for approvals/MCP eventually resolved; the PC shell approvals area then showed the cross-site refusal. No tools were run.
- **Chat / Voice:** Chat is unsigned but renders. It says Grok is configured after status check; initial transient state was “Checking.” Voice is described as browser speech, not a realtime session; voice/connected services prompt for sign-in. Settings labels Voice not connected. No direct Voice sidebar page was found.
- **Library / Projects:** Library has no files. Projects reports zero local projects; no local work is shown. These views render without auth.

## Broken, missing, and symptom delta
- **Known symptoms observed:** intermittent Universe paint delay; repeated `forbidden_cross_site`; empty Memory and local-data panels; Explore templates only; Scheduled has no worker; Grok configured vs Safe Keys unavailable mismatch.
- **Known audit-login placeholder:** not reproduced; `/dashboard` did not bounce to `/login` in this pass.
- **New symptom type:** none clearly established. Cross-site refusal also surfaced within Tools/PC shell approvals, not only Activity.
- **Visual note:** Chat/home uses a dark glass-card layout; on the captured viewport, several translucent panels sit behind the composer and some small labels are low-contrast/dense. This is a readability concern, not a proven functional failure.

## Screenshot files
`01-dashboard.png`, `02-memory.png`, `03-explore.png`, `04-chat.png`, `05-library.png`, `06-projects.png`, `07-scheduled.png`, `08-tools.png`, `09-activity.png`, `10-safe-keys.png` — all in `/workspace/rea-captures/pass-2026-11-07az/`.
