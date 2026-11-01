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

