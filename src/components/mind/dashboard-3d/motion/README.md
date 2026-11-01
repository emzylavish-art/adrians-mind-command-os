# motion/ — Cosmos Motion Bot lane

Star pulses, orbital drift, transition easing, prefers-reduced-motion helpers.

Owned via `dashboard-3d-visual-motion.lock` on `dashboard-3d-visual-motion`.

## Scene integration

Universe / node-graph should call:

- `sampleStarPulse(out, t, phase, health, reducedMotion)` each frame (reuse one `PulseSample`)
- `sampleOrbitDrift(out, base, t, phase, reducedMotion)` then write into mesh.position
- `easeInOutCubic` / `smootherstep` for any local transition polish alongside camera-rig

Do not allocate inside the rAF tick. See INTEGRATION.md.
