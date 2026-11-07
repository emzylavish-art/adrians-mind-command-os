# Visual walk pass 2026-11-07h (read-only, no login attempted)
Screenshot caveat: browser/Computer screenshots are stored off-box and could not be written to /workspace; no PNGs saved. Findings are from rendered text + viewed screenshots (dashboard, explore).

- Auth: no login bounce, no Access denied, no "Something went wrong". Session chrome present as "Adrian (Personal)".
- /dashboard: Universe painted (fleet 3D scene, 18 bot labels) within ~6s; no "Painting the universe…" seen, no hang. Panels: Notion Galaxy Unavailable (no snapshot, NOTION_TOKEN unset); Money "no spend source yet"; Fleet plan "Queue unavailable" (painter/light/motion idle); Weather "Quiet void 18 idle"; Cosmos light/motion/painter "pending · no hops reached"; charts all "no source yet"; Interior "Building data unavailable". Empty panels: all of these.
- /memory: loads; "No saved memory yet" (empty by design); global notes only.
- /explore: 10 Official templates, all TEMPLATE + NOT LIVE badges; My agents 0; Video/Audio/Budget 0. Honest labelling.
- Header: "Grok configured" (all views). Settings > Safe Keys: Chat "NOT CONNECTED — CONFIGURATION UNAVAILABLE" (all 6 caps). Connected: Grok "KEY PRESENT… not live-verified". Integrations: Grok chat CONFIGURED, live reply not verified. Mild mismatch: header "configured" vs Safe Keys "not connected" (wording differs; Safe Keys says inventory is not evidence). Not outright dishonest but inconsistent.
- Library: empty ("No files yet"). Projects: 0 on device, Oak Bridge/BridgePoint EXTERNAL. Scheduled: "No worker process is running"; no schedules; local DB, not hosted.
- Activity: list of forbidden_cross_site ("Forbidden: cross-site request blocked"), latest Nov 6 7:53 PM, 17+ entries, also in home Recent Activity.
- Tools, Skills, Runs, Build, Bots & Agents: each shows a "Forbidden: cross-site request blocked | Retry | View log | Dismiss" banner on open (forbidden_cross_site persists). Connected/Integrations did not show banner in captured text. Tools: web search/browser/gmail/model not available. Skills: local ones ON, Notion/Cloud browser/Voice NOT INSTALLED. Runs: no runs. Build: Local Companion not paired.
- Connected: Notion/GitHub/Gmail/Drive NOT CONFIGURED (OAuth env missing). Integrations: Dedicated DB BLOCKED (DATABASE_URL not set; PGLite) — NOTE home System Status says "DATABASE_URL OR POSTGRES_URL IS SET… REMOTE CONFIGURED": contradiction. REA BLOCKED (doctor unhealthy), PC control BLOCKED (HP not paired).
- Home status card timestamps show last check Nov 6 8:03 PM (clock of page).
- Settings: Voice saved locally, provider not called; failover Off. Dashboard link reachable via Settings nav (Workspace list).

NEW vs standing: Possibly NEW: Database contradiction (home "set/REMOTE CONFIGURED" vs Integrations "DATABASE_URL not set/BLOCKED"). Unchanged/standing: forbidden_cross_site on Activity/Tools/Skills/Runs/Build/Agents; Universe paints OK; no Access denied; Explore TEMPLATE/NOT LIVE; Scheduled no worker; Safe Keys not connected; empty panels. Not exercised: Voice mode, Artifacts/Canvas (not found in nav), destructive/send controls.

## DB status verify
Checked 2026-11-07 (read-only, no login). /dashboard (3D view) has no DB text; System Status card is on home `/` (/integrations and /connected 404; "Connected" is a panel opened from home via "Review connected services").

- Home > System Status > Database (rendered uppercase): "DATABASE_URL OR POSTGRES_URL IS SET. NO RESTART TEST WAS RUN AGAINST THAT HOST." / badge "REMOTE CONFIGURED". Adjacent line: "GROK: CONFIGURED. CHECKED NOV 6, 8:09 PM. NO DEDICATED PROJECT YET. THE FREE ORGANIZATION ALREADY HOLDS TWO ACTIVE PROJECTS."
- Connected panel: no "Dedicated DB", "DATABASE_URL", "PGLite" or "BLOCKED" string anywhere (full text read). Its statuses are KEY PRESENT / NOT CONFIGURED / NOT CONNECTED / NOT CALLED / NOT REALTIME / NOT PAIRED only.

Verdict: contradiction NOT reproduced on the live site. The reported Dedicated DB / PGLite / BLOCKED wording is not visible in Connected on the live unauthenticated build (may be in a different build/branch or authenticated view). Only a mild tension: "REMOTE CONFIGURED" next to "NO DEDICATED PROJECT YET" in System Status.
