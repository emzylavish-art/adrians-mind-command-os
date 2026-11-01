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

## Node open/close + scene transition easing (c6)

Pure helpers in `transition-ease.ts`. Wire from UniverseScene / detail card / flyover FSM
(cannot edit those from this lane).

```ts
import {
  createNodeOpenState, setNodeOpen, stepNodeOpen, createNodeOpenSample,
  createSceneTransitionState, beginSceneTransition, cancelSceneTransition,
  stepSceneTransition, createSceneTransitionSample,
} from "./motion";

// Node detail card (one state per openable node, reuse sample):
const nodeOpen = createNodeOpenState(false);
const nodeSample = createNodeOpenSample();
// on select: setNodeOpen(nodeOpen, true); on dismiss: setNodeOpen(nodeOpen, false);
// rAF: stepNodeOpen(nodeOpen, nodeSample, dt, reducedMotion);
// apply nodeSample.scale / .opacity / .offsetY to the detail mesh/CSS2D.

// Scene level change (universe↔city↔interior):
const sceneTx = createSceneTransitionState();
const sceneSample = createSceneTransitionSample();
// on level change: beginSceneTransition(sceneTx, prevLevel, nextLevel);
// on cancel / zoom-out interrupt: cancelSceneTransition(sceneTx);
// rAF: stepSceneTransition(sceneTx, sceneSample, dt, reducedMotion);
// fadeOut/fadeIn → layer opacities; dolly → camera mix factor.
```

Interruptible: reversing mid-open or canceling a crossfade continues from the current amount.
Reduced-motion snaps. `MotionClock` + `focus-ease` APIs unchanged.

## Character idle / walk (c7)

Imagine-zone characters are billboard planes (`userData.kind === "character"` on bot portraits,
plus scene arts such as `scene-agents-walk.webp`). No skeletal rig yet — drive offset/yaw:

```ts
import {
  createCharacterMotionState, createCharacterSample, stepCharacterMotion,
} from "./motion";

// once per character mesh:
const charState = createCharacterMotionState();
const charSample = createCharacterSample();

// rAF — speed 0 idle / >0 walk; lookYaw toward camera or focus:
stepCharacterMotion(charState, charSample, botId, wallT, dt, reducedMotion, {
  speed: isWalking ? 1 : 0,
  lookYaw: yawTowardCamera,
});
person.position.y = baseY + charSample.offsetY;
person.position.x = baseX + charSample.offsetX;
person.rotation.y = charSample.yaw;
person.scale.y = charSample.scaleY;
```

Per-id phase desyncs a crowd. Reduced-motion → static pose. `MotionClock` / focus-ease /
transition-ease APIs unchanged. **Note:** `sharedMotionClock.reset()` is a no-op (c7) — use
`createMotionClock()` for private resettable clocks.

