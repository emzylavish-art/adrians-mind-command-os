# Dashboard forever-contract upgrade queue

Ordered. Status: `done` | `active` | `queued`.  
Branch: `dashboard-3d` · Light lane worktree: `/workspace/mind-command-os-dashboard-light`  
Constraint: light lane only edits `atmosphere/` + `postfx/` (+ tests) + this file (append).

| # | Upgrade | Status | Notes |
|---|---------|--------|-------|
| 0 | **Universe** — painterly cosmos, constellations, Notion galaxy snapshot, weather, fly-to camera rig foundation | **active** | Dashboard Bot ship (do not duplicate skybox) |
| 0b | **Light — health-tinted lights + bloom/color-grade** | **done** | Cosmos Light Bot; modules under atmosphere/ + postfx/; awaits universe-scene hook |
| 1 | **Camera / city flyover + Projects** | queued | |
| 2 | **Click-and-zoom** | queued | |
| 3 | **Animation pass** | queued | |
| 4 | **Sound** | queued | |
| 5 | **Time** | queued | |
| 6 | **Feed** | queued | |
| 7 | **Money** | queued | |
| 8 | **Operator layer** | queued | |
| 9 | **Notion mirror** | queued | |
| 10 | **Forever-contract guard** | queued | |
| 11 | **Light — depth-aware god-ray shafts** | queued | Soft volumetric shafts from orchestrator sun; intensity ↔ healthy count; off under reduced-motion |

## After each upgrade
1. Commit + push `origin/dashboard-3d` (never main, no force).
2. Append stop-point to Notion `40b1aa27632381768d58cde0731f142a`.
3. Update this file (status + next researched item so queue never empties).

## Next researched (tail — keep non-empty)
- **Depth-aware god-ray shafts** (next light-lane) — soft volumetric shafts from orchestrator sun, intensity tied to healthy count; honest off when WebGL/reduced-motion.
- **Health-reactive exposure ride** — ACES exposure + bloom threshold ease over 400ms when weather.tone changes (pairs with color-grade).
- **Constellation lore plaques** — short painted plaques per lane with last 3 lock notes + health reason.
- **Pairing beacon** — HP Pairing star lighthouse sweep on paired PC heartbeat.

## Light-lane hook (required outside lane dirs — Dashboard Bot must apply)
In `universe-scene.tsx` after scene + composer setup:
`import { createHealthAtmosphere, deriveFleetTone } from "./atmosphere";`
`import { createTunedBloomPass, createColorGradePass } from "./postfx";`
then `const atm = createHealthAtmosphere(scene, { attachFog: false });` (replace static Ambient/Point lights);
replace bare `UnrealBloomPass(...)` with `createTunedBloomPass(size, tone).pass` + add `createColorGradePass(tone).pass`;
call `atm.update` / `bloom.update` / `grade.update` from `status.weather.tone` (or `deriveFleetTone`) on rebuild.
