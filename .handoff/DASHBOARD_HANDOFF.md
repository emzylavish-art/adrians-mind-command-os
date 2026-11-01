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

## Nav gap (no command-app / styles.css edits)
No in-app nav entry to  yet ( claimed by other lanes;  claimed by visual-polish).
**Options without claimed files:** (1)  on  (unclaimed), (2) tiny chrome link in  (unclaimed, avoid importing styles.css tokens beyond existing). Not applied this milestone — left for a quiet unlock or Merge Gate companion.

## Preview ports (reserved)
- **8100** — reserved for **dashboard-3d main preview** (`/workspace/mind-command-os-dashboard`, tip on `dashboard-3d`). Fleet bots must **not** bind 8100.
- **8110 / 8111 / 8112** — reserved for Cosmos Painter / Light / Motion fleet worktree previews.
- 8098 may be occupied by a fleet worktree; do not assume it is the main dashboard.

## Security / preview
The Vite **dev server exposes server functions**. It must **never be tunneled publicly without auth**.
Main preview reserved on **:8100**; fleet previews **8110–8112**.

## Hacker pass (2026-11-01)
- Fixed false red health when lock **notes** mention BLOCKED/404/Unauthorized, or status=blocked with **released_at** (ended cycle) → stalled/not active red.
- Allowlisted `MIND_LOCKS_DIR` / `MIND_REPO_DIR`; refuse huge lock files; sanitize CSS2D labels.

