# motion/ — Cosmos Motion Bot lane

Star pulses, orbital drift, transition easing, prefers-reduced-motion helpers.

Owned via `dashboard-3d-visual-motion.lock` on `dashboard-3d-visual-motion`.

## Scene integration

Universe / node-graph should call:

- `sampleStarPulse(out, t, phase, health, reducedMotion)` each frame (reuse one `PulseSample`)
- `sampleOrbitDrift(out, base, t, phase, reducedMotion)` then write into mesh.position
- `easeInOutCubic` / `smootherstep` for any local transition polish alongside camera-rig

Do not allocate inside the rAF tick. See INTEGRATION.md.

## Focus-aware star easing (c5)

- `stepFocusEase(state, starId, focusId, dt, reducedMotion)` — per-star `pulseMul`→1.25 / `driftMul`→0
- `applyFocusPulse` / `applyFocusDrift` after the usual samplers
- Unknown/empty `focusId` = no focus; reduced-motion snaps. Wire `focusId` from `rig.subjectId` (see INTEGRATION.md).

## Node open/close + scene transitions (c6)

- `stepNodeOpen` — interruptible scale/opacity/offsetY (reverse mid-open resumes from current)
- `stepSceneTransition` — crossfade (`fadeOut`/`fadeIn`) + `dolly` progress; `begin`/`cancel`
- Reduced-motion snaps. See INTEGRATION.md for UniverseScene wiring.

## Character idle / walk (c7)

- `stepCharacterMotion` — idle bob/breath + walk bounce/sway/stride, look-yaw damp, loco blend
- `characterPhaseFromId` — stable crowd desync; reduced-motion = static pose
- Targets Imagine-zone billboard characters (`kind: "character"`) and scene walk arts

## Star focus breadcrumb ease (c8)

- `stepBreadcrumbEase` — interruptible slide+fade for Flyover HUD focus crumb (`rig.subjectId`)
- Complements Dashboard queue #21; markup/styles not owned here
- Hacker c8: hot-path `opts = {}` → frozen empty (no per-frame alloc); `+Infinity` walk speed; `hardResetSharedMotionClockForTests`

## Pan / remount pose hold (c9)

- `capture*Pose` / `restore*Pose` + `MotionPoseBag` — keep focus/character/breadcrumb/node/scene easing across UniverseScene remount
- Complements Dashboard #25 last-frame freeze (canvas snapshot); this covers motion state
- Hacker c9: remount without restore snaps mid-ease; sprite refs ≥0 under double dispose; 100k-frame stress

## Star hover tooltip motion (c10)

- `hover-tooltip-motion.ts` — intent delay + fade/lift/scale + edge strength; reduced-motion snaps
- Hacker c10: pose-hold corrupted/stale/__proto__ JSON; known-id restore; tab-hidden dt spike

## Constellation edge pulse sync (c11)

- `edge-pulse-sync.ts` — phase-lock edge highlight to MotionClock / star pulse; travel toward focus; neighbor damp; reduced-motion static
- Hacker c11: hover 1kHz thrash; pose-hold 100k-id for-in cap; `lastWallDt >= 0` on backwards wall

## Landing-trail traveler ease (c12)

- `traveler-ease.ts` — MotionClock-phased polyline travel; pause/resume; reduced-motion static
- Hacker c12: edge-pulse self-loop/null endpoints; step* determinism; lazy shared clock (tree-shake)

## Dust wind gust (c13)

- `wind-gust.ts` — capped impulse superposition + decay; reduced-motion = no gust
- `particles/dust-field` — `impulseGust` / `gust` hook (update API unchanged)
- Hacker c13: traveler degenerate polylines; pause abuse; 1000-event gust flood capped

