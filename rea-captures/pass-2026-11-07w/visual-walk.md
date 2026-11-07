# Visual walk 2026-11-07 (Adrian's Mind) — read-only, no login attempted
## URL outcomes
- /dashboard: 200, final URL /dashboard, NO bounce to /login, no Access denied/Something went wrong. Renders (unauthenticated).
- /memory 200, /explore 200, / 200 (home chat shell). /chat 404, /activity 404, /tools 404 ("Page not found ... Return to Adrian's Mind").
## Universe (/dashboard)
- Canvas painted within ~8s; "Painting the universe…" not present. Side cards: NOTION GALAXY Unavailable ("No Notion snapshot file found and NOTION_TOKEN unset"), MONEY "no spend source yet", FLEET PLAN "Queue unavailable", SYSTEM WEATHER Quiet void 18 idle. Bots all idle; Cosmos light/motion/painter "pending · no hops reached"; TIME "No git/lock history on box yet"; Feed 4 events. Scene is dim/sparse.
## Per view
- Home (/): header "Grok configured"; Memory OFF; effort tiers note "NOT WIRED TO A DIFFERENT MODEL"; Database "REMOTE CONFIGURED"; Recent Activity lists repeated forbidden_cross_site entries (Nov 6 10:49–11:13 PM). Sidebar only: Library, Projects, Scheduled, Explore (no Tools/Connected/Skills/Build/Runs/Research/Agents/Activity entries).
- Memory: empty ("No saved memory yet"), global notes only; no errors.
- Explore: 10 official templates, all TEMPLATE / NOT LIVE; My agents 0.
- Library: empty, "No files yet".
- Projects: 0 local; external Oak Bridge Capital, BridgePoint.
- Scheduled: "No worker process is running"; no schedules.
- Not reachable in sidebar: Tools, Connected, Skills, Build, Runs, Research, Agents, Safe Keys (Tools/Agents only as composer buttons, not opened).
## Header Grok status: "Grok configured" on every view (while XAI key known unset => honesty concern, known).
## Classification
KNOWN: forbidden_cross_site (visible in Recent Activity), explore TEMPLATE/NOT LIVE, Scheduled no worker, empty panels, sidebar/deep-link 404s (/chat /activity /tools), Grok status honesty, Notion token unset.
NEW: (1) /dashboard loads fully WITHOUT login on prod now (no 307→login in browser; contradicts "curl dashboard 307→login") — possible auth-gate regression/exposure of bot fleet data. (2) Universe painted OK this pass (hang intermittent known). (3) Dashboard side cards: Notion Galaxy unavailable/NOTION_TOKEN unset, Money no spend source, Fleet plan queue unavailable, Time "No git/lock history" — empty-card list. (4) Sidebar lacks Tools/Activity/etc. entirely (only 4 items). 
Screenshots: 01-dashboard, 02-memory, 03-explore, 04-chat-404, 05-home-chat, 06-library, 07-projects, 08-scheduled (.png)
