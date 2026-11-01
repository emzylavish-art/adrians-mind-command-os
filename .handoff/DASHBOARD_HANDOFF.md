# Dashboard 3D lane handoff

**Branch:** `dashboard-3d`  
**Worktree:** `/workspace/mind-command-os-dashboard`  
**HEAD (pre-final):** see latest commits  
**Preview:** http://127.0.0.1:8098/dashboard  
**Screenshots:** `/workspace/audit/dashboard-3d/universe.png`, `universe-focus.png`

## Cadence
Continuous back-to-back (no 2h interval). 5-minute safety restart skips if a cycle is running. Report every two upgrades.

## Universe ship
- Painterly Three.js cosmos; 14 lanes + Dashboard + Visual Fleet (3 cosmos bots)
- Constellations + health nebula tints + system weather
- Notion galaxy from MCP snapshot (60 pages / 189 edges / 15 bots mapped); live token preferred when present
- Camera rig FSM foundation (universe→city→interior) with fly-to / dolly / sky zoom
- Extension folders: shaders/, materials/, atmosphere/, postfx/, motion/, particles/
- Notion.so blocks iframe embedding — Open in Notion link only

## Honest unavailable
- NOTION_TOKEN unset → status Notion stop-points unavailable (graph uses snapshot)
- Primary Notion page `40b1aa27…` object_not_found → mirror `40bb95f3…`
- Conductor nudges / API spend still no live sources

## Queue
See `.handoff/DASHBOARD_QUEUE.md` — next: Camera/city + Projects.
