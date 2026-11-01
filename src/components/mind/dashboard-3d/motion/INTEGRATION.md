# Integration request (Cosmos Motion Bot → Dashboard Bot)

UniverseScene already samples pulse/orbit/dust/comets. **c5 addition — focus-aware star easing**
(cannot land in-scene from this lane; wire below inside `universe-scene.tsx`).

## Focus-aware star easing (`focusId`)

When the operator selects/hovers a star (click-and-zoom #2), ease that star to a **1.25× pulse**
and damp its **orbit drift to 0** so the camera lands on a still target. Reduced-motion = instant.

```ts
import {
  sampleStarPulse,
  sampleOrbitDrift,
  pulsePhaseFromId,
  createFocusEaseState,
  stepFocusEase,
  applyFocusPulse,
  applyFocusDrift,
  type FocusEaseState,
} from "./motion";

// once per bot vis (alongside botVis):
const focusEase = new Map<string, FocusEaseState>();
for (const n of botVis) focusEase.set(n.id, createFocusEaseState());

// each rAF tick — focusId from rig.subjectId (or hover id when set):
const focusId = rig.subjectId; // string | null
for (const n of botVis) {
  const phase = pulsePhaseFromId(n.id);
  sampleStarPulse(pulseOut, wallT, phase, n.health, reducedMotion);
  sampleOrbitDrift(driftOut, n.base, wallT, phase, reducedMotion);
  let st = focusEase.get(n.id);
  if (!st) { st = createFocusEaseState(); focusEase.set(n.id, st); }
  stepFocusEase(st, n.id, focusId, dt, reducedMotion);
  applyFocusPulse(pulseOut, st.pulseMul);
  applyFocusDrift(driftOut, n.base, st.driftMul);
  n.mesh.scale.setScalar(pulseOut.scale);
  n.glow.scale.setScalar(pulseOut.glow);
  n.mesh.position.set(driftOut.x, driftOut.y, driftOut.z);
  n.glow.position.copy(n.mesh.position);
}
```

`MotionClock` API is unchanged. Do not fabricate commits — pass `status.commits` only.

## Prior (still valid)

```ts
import { createDustField, createCommitComets } from "./particles";
const dust = createDustField(scene, { count: 480 });
const comets = createCommitComets(scene, dataRef.current.commits, { max: 6 });
dust.update(t, reducedMotion);
comets.update(t, reducedMotion);
```
