# Dashboard forever-contract upgrade queue

## Cadence (Zack 2026-11-01)

2-hour interval **removed**. Dashboard Bot + visual fleet (Painter/Light/Motion) run **continuously**, back-to-back. After each landing, start the next cycle immediately. **5-minute safety restart** skips if a cycle is already running (no-ops while the lane lock is claimed). Report to parent every **two** upgrades.

Last release: Dashboard c9 — click-and-zoom (#2) + animation (#3) + hacker glide-spam / lock-commit cap. Next: #4 Sound.

Ordered. Status: `done` | `active` | `queued`.  
Branch: `dashboard-3d` · Worktree: `/workspace/mind-command-os-dashboard`  
Painter lane branch: `dashboard-3d-visual-painter` · Worktree: `/workspace/mind-command-os-dashboard-painter`  
Constraint: only this branch/worktree, `/workspace/locks/dashboard-3d*.lock`, `/workspace/audit/dashboard-3d/`, Notion handoff pages.

| # | Upgrade | Status | Notes |
|---|---------|--------|-------|
| 0 | **Universe** (+ Visual Fleet stars + extension folders) — painterly cosmos, constellations, Notion galaxy snapshot, weather, fly-to camera rig foundation | **done** | Landed on dashboard-3d; light/painter/motion fill lane folders |
| 0b | **Light — health-tinted lights + bloom/color-grade** | **done** | Cosmos Light Bot; wired in 405ef30 |
| 0c | **Painter kit (shaders/materials)** — brush/watercolor ShaderMaterials, star+building surfaces, paper grain, procedural nebula, painterly post-pass + `createPainterlyKit` | **done** | Cosmos Painter Bot; wired in 405ef30 |
| 0d | **Painter — constellation lore plaques** — watercolor plaque ShaderMaterial + procedural parchment | **done** | Cosmos Painter Bot; `createLorePlaqueMaterial` + `makeParchmentRGBA`; sky dispose leak + mediump paintWrap hacker fixes |
| 1 | **Camera / city flyover + Projects** — universe→city→interior FSM; projects as painted buildings (progress floors, tasks, bots, agent stats); real local data only | **done** | 29addee — `flyover-fsm.ts` + `city-layout.ts` + `city/city-layer.ts` (createBuildingBrushMaterial) + interior panel/HUD; wheel-push crosses levels, city pan clamped; shots flyover-high/city/interior. Remaining polish → folded into #2 (real canvas door/window click tuning, damped dolly) |
| 2 | **Click-and-zoom** — star click eases camera in + detail; wheel/pinch dolly; empty-space/zoom-out → sky; reuse camera FSM | **done** | c9 — damped glide (`stepRigSmooth`), glide-spam guard, pinch+wheel dolly, detail card (lane health, commits, API spend honest empty, status); empty-click / Zoom to sky → `UNIVERSE_HIGH`; reuses flyover FSM |
| 3 | **Animation pass** — living motion: orbiting, drifting, pulsing, transition polish | **done** | c9 — star pulse/emissive by health, constellation edge flow, landing-trail travelers, MotionClock + `document.hidden` pause, reduced-motion static; tickPainterlyKit wired |
| 4 | **Sound** — WebAudio procedural only; health tones spatialized; muted by default + unmute toggle | queued | |
| 5 | **Time** — timeline scrubber from git commits + lock timestamps; real data only | queued | |
| 6 | **Feed** — Conductor nudges + Gap Dispatcher as drifting sky events (comets/lanterns) | queued | |
| 7 | **Money** — API spend burn/daily/per-lane warning from real source only; honest empty element | queued | |
| 8 | **Operator layer** — in-dashboard camera/focus/last-node in localStorage only (no geolocation) | queued | |
| 9 | **Notion mirror** — render handoff `40b1aa27…` stop-point + next task in-world (snapshot/MCP; live if token) | queued | Fallback old mirror `40bb95f3…` |
| 10 | **Forever-contract guard** — keep this queue non-empty; append next researched upgrade after each ship; show queue head in-world | queued | |
| 11 | **Light — depth-aware god-ray shafts** | **done** | Cosmos Light Bot c2: `createGodRayPass` (postfx/god-rays.ts) — sun-relative depth occlusion, intensity ↔ healthy/total, off under reduced-motion/no data/sun behind camera; **wire-up TODO** (Dashboard Bot): see `postfx/README.md` |
| 12 | **Light — health-reactive exposure ride** | **done** | Cosmos Light Bot c3: `createExposureRide` (postfx/exposure-ride.ts) — eases toneMappingExposure + bloom threshold over 400ms on tone/ToD change; clamp [0.6,1.4]; snap under reduced-motion; junk→idle; **wire-up TODO** (Dashboard Bot): see `postfx/README.md` |
| 13 | **Light — WebGL context-loss recovery helper** | queued | Cosmos Light Bot next: postfx `onContextLost/Restored` that rebuilds bloom/grade/god-ray/exposure handles; honest "renderer lost" state instead of a frozen frame |

## After each upgrade
1. Commit + push `origin/dashboard-3d` (never main, no force).
2. Append stop-point to Notion `40b1aa27632381768d58cde0731f142a` (fallback `40bb95f33e42814aacf8c3281b4f528d`) with exact text, SHA, results, next justified task.
3. Update this file (status + next researched item so queue never empties).
4. Report at least every **two** upgrades.

## Next researched (tail — keep non-empty)
- **City night-shift windows from lock timestamps** (Dashboard next after #4 Sound, or earlier if Sound blocked) — window glow per floor flickers on only for floors whose task/lock changed in the last 30 min (real claimed_at/released_at), so the city shows *where work is happening now*; static when no recent activity; reduced-motion = steady.
- **Star focus breadcrumb in Flyover HUD** (researched c9) — when a star is focused (`rig.subjectId`), show its name + lane health in the Flyover HUD with a "Back to sky" twin of Zoom to sky; keeps keyboard users oriented without opening the side card.
- ~~**Motion LOD / visibility budget**~~ — **done (Cosmos Motion Bot c3)**: camera-distance dust LOD via `onBeforeRender`, frame-budget governor (EMA >24ms trims to 30% floor, recovers <18ms), active-slice instance upload, `document.hidden` pause; plus shared continuous `MotionClock` (no teleport on tab resume / 24h fold).
- **Motion — comet tail fade** — additive vertex-color head→tail gradient + brighter head point on commit comets; dimmed static under reduced-motion (Cosmos Motion Bot next).

- **Painter — ink-wash constellation edge ribbons** — ShaderMaterial/Line2 ribbons replacing LineBasic edges; health-tinted wash; mediump-safe (next painter cycle).
- **Painter — lore plaque text atlas** — procedural canvas glyph atlas for lock-note body text on plaques (no external fonts/assets).
- ~~**Health-reactive exposure ride**~~ — **done (Cosmos Light Bot c3, queue #12)**: `createExposureRide` eases ACES exposure + bloom threshold over 400ms; ToD scale; reduced-motion snap; wire-up TODO.
- **Light — WebGL context-loss recovery helper** (next light-lane, queue #13) — postfx `onContextLost/Restored` that rebuilds bloom/grade/god-ray/exposure handles; honest "renderer lost" state instead of a frozen frame.
- **Pairing beacon** — HP Pairing star becomes a lighthouse sweep when a paired PC heartbeat appears (env/agent URL); honest dark when absent.
- **Light — volumetric fog density ride** — FogExp2 density eases with altitude (universe→city→interior) using real flyover FSM level; pairs with exposure ride; static under reduced-motion.

## Visual Fleet

Parallel polish bots land into `dashboard-3d` only while holding `dashboard-3d.lock`.

| Bot | Lane lock | Branch | Paths (only) |
|-----|-----------|--------|----------------|
| Cosmos Painter Bot | `dashboard-3d-visual-painter.lock` | `dashboard-3d-visual-painter` | `src/components/mind/dashboard-3d/shaders/`, `materials/` |
| Cosmos Light Bot | `dashboard-3d-visual-light.lock` | `dashboard-3d-visual-light` | `atmosphere/`, `postfx/` |
| Cosmos Motion Bot | `dashboard-3d-visual-motion.lock` | `dashboard-3d-visual-motion` | `motion/`, `particles/` |

Rules:
1. **Main queue head has priority** over fleet polish when both need the shared worktree.
2. Fleet **never** edits files outside its lane folders (or its own lock).
3. Fleet bots appear as stars in the **Visual Fleet** constellation; health comes from their lane lock (no lock ⇒ idle).
4. Hold `dashboard-3d.lock` only while actively merging/editing the shared worktree; **release between milestones** so fleet can land.
