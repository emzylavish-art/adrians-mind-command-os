# Dashboard forever-contract upgrade queue

Ordered. Status: `done` | `active` | `queued`.  
Branch: `dashboard-3d` · Worktree: `/workspace/mind-command-os-dashboard`  
Painter lane branch: `dashboard-3d-visual-painter` · Worktree: `/workspace/mind-command-os-dashboard-painter`  
Constraint: only this branch/worktree, `/workspace/locks/dashboard-3d*.lock`, `/workspace/audit/dashboard-3d/`, Notion handoff pages.

| # | Upgrade | Status | Notes |
|---|---------|--------|-------|
| 0 | **Universe** — painterly cosmos, constellations, Notion galaxy snapshot, weather, fly-to camera rig foundation | **active** | Dashboard Bot current ship; painter kit modules ready to consume |
| 0b | **Painter kit (shaders/materials)** — brush/watercolor ShaderMaterials, star+building surfaces, paper grain, procedural nebula, painterly post-pass + `createPainterlyKit` hook | **done (painter lane)** | Files under `src/components/mind/dashboard-3d/shaders/` + `materials/`; wire-up TODO for owner (see materials/WIRING_TODO.md) |
| 1 | **Camera / city flyover + Projects** — universe→city→interior FSM; projects as painted buildings (progress floors, tasks, bots, agent stats); real local data only | queued | Gap lock `dashboard-3d-gap-projects-dashboard.lock`; use `createBuildingBrushMaterial`; shots flyover-high/city/interior |
| 2 | **Click-and-zoom** — star click eases camera in + detail; wheel/pinch dolly; empty-space/zoom-out → sky; reuse camera FSM | queued | Shots zoom-star.png, zoom-sky.png |
| 3 | **Animation pass** — living motion: orbiting, drifting, pulsing, transition polish | queued | After click-zoom; tickPainterlyKit time uniforms |
| 4 | **Sound** — WebAudio procedural only; health tones spatialized; muted by default + unmute toggle | queued | |
| 5 | **Time** — timeline scrubber from git commits + lock timestamps; real data only | queued | |
| 6 | **Feed** — Conductor nudges + Gap Dispatcher as drifting sky events (comets/lanterns) | queued | |
| 7 | **Money** — API spend burn/daily/per-lane warning from real source only; honest empty element | queued | |
| 8 | **Operator layer** — in-dashboard camera/focus/last-node in localStorage only (no geolocation) | queued | |
| 9 | **Notion mirror** — render handoff `40b1aa27…` stop-point + next task in-world (snapshot/MCP; live if token) | queued | Fallback old mirror `40bb95f3…` |
| 10 | **Forever-contract guard** — keep this queue non-empty; append next researched upgrade after each ship; show queue head in-world | queued | |

## After each upgrade
1. Commit + push `origin/dashboard-3d` (never main, no force).
2. Append stop-point to Notion `40b1aa27632381768d58cde0731f142a` (fallback `40bb95f33e42814aacf8c3281b4f528d`) with exact text, SHA, results, next justified task.
3. Update this file (status + next researched item so queue never empties).
4. Report at least every **two** upgrades.

## Next researched (tail — keep non-empty)
- **Painter kit wire-up** — Dashboard Bot imports `createPainterlyKit` into `universe-scene.tsx`; replace inlined PainterlyShader / canvas helpers; enable star watercolor + post-pass on live preview.
- **Constellation lore plaques** — short painted plaques per lane with last 3 lock notes + health reason, readable when camera is mid-dolly (plaque ShaderMaterial variant).
- **Pairing beacon** — HP Pairing star becomes a lighthouse sweep when a paired PC heartbeat appears (env/agent URL); honest dark when absent.
