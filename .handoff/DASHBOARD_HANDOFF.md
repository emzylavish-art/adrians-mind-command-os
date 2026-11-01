# Dashboard 3D lane handoff

**Branch:** `dashboard-3d` (pushed to origin)  
**Worktree:** `/workspace/mind-command-os-dashboard`  
**Base:** `f2b88fd` (origin/main)  
**HEAD:** `15026e7` (`15026e797c8d0363aa70cce0a160f5046c0b1d63`)  
**Date:** 2026-11-01 (Africa/Lagos)  
**Preview URL:** http://127.0.0.1:8098/dashboard (also http://172.30.0.2:8098/dashboard)  
**Screenshot:** `/workspace/audit/dashboard-3d/dashboard.png`

## What shipped

1. **Status API** `GET /api/mind/dashboard/status`
   - Parses `/workspace/locks/*.lock` (env `MIND_LOCKS_DIR`, default `/workspace/locks`)
   - Recent git commits via `git for-each-ref` / `git log` (env `MIND_REPO_DIR`, default `/workspace/mind-command-os`)
   - Gap Dispatcher feed from newest `/workspace/rea-captures/gap-list-*.json`
   - Orchestrator from `integration.lock` / Grok Build
   - Notion stop-points when `NOTION_TOKEN` present; otherwise honest unavailable
   - API spend only if a real usage/spend/cost log exists (none found → unavailable)
   - Conductor nudges: searched common paths; none found → `source:'unavailable'`
   - Health: healthy / stalled (>30m claimed idle) / blocked / idle (no lock)

2. **Client** `/dashboard`
   - Pure Three.js WebGL node graph (OrbitControls + UnrealBloomPass + CSS2D labels)
   - 15 bot nodes (14 lanes + Dashboard Bot), glass HUD panels, side detail on click
   - Poll every 5s; WebGL fallback list; respects `prefers-reduced-motion`
   - Scoped styles in `src/components/mind/dashboard-3d/dashboard-3d.css` (did not touch `styles.css`)

3. **Tests**
   - `src/lib/mind/dashboard/locks.test.ts` + `health.test.ts` (7/7 pass)
   - `npm run typecheck`: pass
   - Full `npm test`: 198/202 pass (4 pre-existing fails: missing gitignored `.grok/skills/og`)

## Commits

- `8833f5e` Add Mind dashboard status lib (locks, health, git, feeds).
- `6734381` Expose GET /api/mind/dashboard/status for the 3D command board.
- `b454787` Add Three.js /dashboard node graph with dark-glass HUD.
- `15026e7` Wire three dependency, route tree, and dashboard unit tests.
- (this commit) Document dashboard-3d handoff.

## Live vs unavailable (box at ship time)

| Source | State | Why |
|---|---|---|
| Locks | **live** | `/workspace/locks` readable |
| Git commits | **live** | repo at `/workspace/mind-command-os` |
| Gap Dispatcher | **live** | `gap-list-2026-11-01-c2.json` |
| Orchestrator | **live** | `integration.lock` (Grok Build) |
| Notion (status API) | **unavailable** | `NOTION_TOKEN` unset on box |
| Conductor nudges | **unavailable** | no conductor feed files under `/workspace` |
| API spend | **unavailable** | no spend/usage/cost log found |

## Notion append

Stop-point appended to mirror page `40bb95f33e42814aacf8c3281b4f528d` via user-Notion `notion-update-page` `insert_content` (returned page id). Preview later moved to :8098 after media took :8096.

## Off-limits respected

Did not touch `src/styles.css`, `command-app.tsx`, voice/, media/, mcp/, `server.ts`, or other worktrees. No push to main, no deploy, no force-push.

## Ranked next visual upgrades

1. **Click-to-focus camera + activity edge pulse trails** — orbit tween to selected bot; edges pulse on fresh commits.
2. **Live spend sparkline HUD** — when a real cost/usage log appears, tick a mini chart instead of "not connected".
3. **Time-scrub / replay** — scrub last N minutes of lock transitions as ghost trails on the graph.
