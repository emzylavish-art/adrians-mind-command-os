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
transition-ease APIs unchanged. **Note:** `sharedMotionClock.reset()` is a no-op (c7) — use `createMotionClock()` for
private resettable clocks. For an intentional wipe of the singleton (tests / full teardown
only), call `hardResetSharedMotionClockForTests()` — nothing on `origin/dashboard-3d` was
calling `sharedMotionClock.reset()` for effect (c8 grep).

## Star focus breadcrumb ease (c8)

Motion-only helpers for Dashboard queue #21 (HUD markup/CSS stay with Dashboard Bot):

```ts
import {
  createBreadcrumbEaseState, createBreadcrumbEaseSample,
  setBreadcrumbFocus, clearBreadcrumbFocus, stepBreadcrumbEase,
} from "./motion";

const bc = createBreadcrumbEaseState();
const bcSample = createBreadcrumbEaseSample();

// when rig.subjectId changes:
if (rig.subjectId) setBreadcrumbFocus(bc, rig.subjectId);
else clearBreadcrumbFocus(bc);

// rAF:
stepBreadcrumbEase(bc, bcSample, dt, reducedMotion);
// apply bcSample.opacity + bcSample.offsetX (px) to the focus crumb element
```

Interruptible exit mid-enter. Reduced-motion snaps. Label text/DOM is Dashboard Bot's job.

## Pan / remount pose hold (c9)

Complements Dashboard #25 last-frame WebGL freeze. Before unmounting UniverseScene
(or on `webglcontextlost`), capture motion state; after remount, restore into fresh
state objects so focus/character/breadcrumb/node/scene easing does not snap.

```ts
import {
  createMotionPoseBag, captureFocusPose, restoreFocusPose,
  captureCharacterPose, restoreCharacterPose,
  captureBreadcrumbPose, restoreBreadcrumbPose,
  captureNodeOpenPose, restoreNodeOpenPose,
  captureSceneTransitionPose, restoreSceneTransitionPose,
  sanitizeMotionPoseBag, createFocusPoseHold, createCharacterPoseHold,
} from "./motion";

const bag = createMotionPoseBag(); // keep across remount (module/ref)

// before teardown:
for (const [id, st] of focusEase) {
  bag.focusById[id] ??= createFocusPoseHold();
  captureFocusPose(bag.focusById[id], st);
}
// …same for characters; then:
captureBreadcrumbPose(bag.breadcrumb, bcState);
captureNodeOpenPose(bag.nodeOpen, nodeState);
captureSceneTransitionPose(bag.sceneTx, sceneTxState);

// after remount — recreate states, then:
sanitizeMotionPoseBag(bag); // if bag was JSON-restored
restoreFocusPose(newFocusState, bag.focusById[id]);
// …
```

Do **not** call `hardResetSharedMotionClockForTests()` on remount — shared clock already survives.

## Star hover tooltip motion (c10)

Complements Dashboard #26 / Gap#4 tooltip + edge highlight. Pure motion only —
HUD markup/CSS stay with Dashboard Bot.

```ts
import {
  createHoverTooltipState, createHoverTooltipSample,
  setHoverTooltipTarget, clearHoverTooltip, stepHoverTooltip,
} from "./motion";

const hover = createHoverTooltipState();
const hoverOut = createHoverTooltipSample();

// on pointer pick (star id or null when miss):
setHoverTooltipTarget(hover, pickedStarId);

// each frame:
stepHoverTooltip(hover, hoverOut, dt, reducedMotion);
// apply hoverOut.opacity / offsetY / scale to tooltip DOM;
// apply hoverOut.edge to constellation edge highlight strength;
// show label for hoverOut.hoverId (null while intent-delaying or fully hidden)

// on fly/focus open:
clearHoverTooltip(hover);
```

Intent delay (`HOVER_INTENT_DELAY` ≈ 90ms) prevents edge-skim flicker. Leaving
hides immediately (no delay). Reduced-motion snaps.

### Pose-hold harden (c10)

- `parseMotionPoseBag(sessionText)` — never throws on tampered JSON
- `sanitizeMotionPoseBag` rebuilds a clean bag (strips `__proto__` / `constructor`, caps ids)
- `restoreFocusPosesForKnownIds` / `restoreCharacterPosesForKnownIds` — skip stale ids

## Constellation edge highlight pulse sync (c11)

Complements Dashboard #26 edge highlight + hover tooltip motion (c10).

```ts
import {
  createEdgePulseState, createEdgePulseSample, stepEdgePulseSync,
} from "./motion";

const edgeSt = createEdgePulseState();
const edgeOut = createEdgePulseSample();

// each frame, per visible constellation edge (fromId→toId):
stepEdgePulseSync(
  edgeSt, edgeOut,
  hoverOut.edge,          // strength from hover tooltip sample
  edge.fromId, edge.toId,
  focusId ?? hoverOut.hoverId,
  tSeconds, reducedMotion,
);
// ribbon opacity = edgeOut.highlight
// wave head along edge = edgeOut.travel (0=from … 1=to, oriented toward focus)
// neighbor star pulse scale *= edgeOut.neighborPulseMul
```

Reduced-motion → static mid-edge highlight, pulse=1. Hacker c11: `lastWallDt` never
negative on backwards worker clocks; pose-hold for-in early-break on huge id maps.

## Landing-trail traveler ease (c12)

Complements Dashboard animation #3 / `sky-flow` travelers. Pure motion only —
mesh/material stay with Dashboard Bot.

```ts
import {
  createTravelerEaseState, createTravelerEaseSample,
  stepTravelerEase, pauseTraveler, resumeTraveler,
} from "./motion";

const st = createTravelerEaseState(seed);
const out = createTravelerEaseSample();

// each frame:
stepTravelerEase(st, out, trailPoints, tSeconds, dt, reducedMotion);
mesh.position.set(out.x, out.y, out.z);
(mesh.material as THREE.Material).opacity = out.opacity;

// interrupt (flyover / panel open):
pauseTraveler(st);
// …later
resumeTraveler(st);
```

Uses MotionClock so tab-resume does not teleport. Reduced-motion → static seed pose.
Hacker c12: edge-pulse self-loop parks travel; shared clock is lazy (no import side effect).

## Dust wind gust on fleet events (c13)

Pure gust math in `wind-gust.ts`; dust-field exposes `impulseGust` without changing `update()`.

```ts
import { createDustField } from "./particles";
// after createDustField(scene, opts):
dust.impulseGust(dx, dy, dz, strength?); // on comet fire / landing hop
dust.update(tSeconds, reducedMotion);    // decays + applies offset
// read dust.gust.speed for HUD/debug
```

1000 impulses in one frame stay ≤ `GUST_MAX_SPEED`. Reduced-motion clears / ignores.
`sharedMotionClock` remains the same exported name/type (lazy inner; importers unchanged).

## Comet launch ease on commit burst (c14)

Pure stagger/cap/ease for fleet commit bursts. `commit-comets` keeps meshes.

```ts
import {
  createCometLaunchState, createCometLaunchSample,
  scheduleCometLaunchBurst, stepCometLaunchEase, clearCometLaunch,
} from "./motion";

const launch = createCometLaunchState(24);
const samples = Array.from({ length: 24 }, () => createCometLaunchSample());

// when a commit burst arrives (N shas):
scheduleCometLaunchBurst(launch, commits.length, reducedMotion);

// each frame:
stepCometLaunchEase(launch, samples, dt, reducedMotion);
// apply samples[i].opacity/scale to comet i (or hide if !visible)
```

Re-call `scheduleCometLaunchBurst` as slots free (concurrent cap). `clearCometLaunch` interrupts.

## Focus-ring breathe (c15)

```ts
import {
  createFocusRingBreatheState, createFocusRingBreatheSample,
  setFocusRingActive, stepFocusRingBreathe,
} from "./motion";

const ring = createFocusRingBreatheState();
const ringOut = createFocusRingBreatheSample();

setFocusRingActive(ring, Boolean(focusId)); // on select/deselect
stepFocusRingBreathe(ring, ringOut, tSeconds, dt, reducedMotion);
// apply ringOut.opacity / ringOut.scale to the selection ring mesh
```

Breathe phase uses MotionClock (survives tab freeze — see REA c15 capture).
Reduced-motion → static base opacity, no breathe.

## Star-field batch step (c16)

Zero-alloc batch for N stars (pulse + focus-ease + orbit + focus apply):

```ts
import { stepStarFieldBatch, createFocusEaseState } from "./motion";

stepStarFieldBatch(ids, healths, bases, focusStates, pulseOuts, posOuts,
  focusId, tSeconds, dt, reducedMotion, ids.length, { clock });
```

### Camera dolly — not Motion lane

Dashboard Bot owns camera fly/dolly (`src/lib/mind/dashboard/camera-rig.ts`
`stepRigSmooth` / `dollyPose`, flyover FSM). Motion will not re-implement
camera dolly ease; pair focus-ring breathe with Dashboard's existing glide.

## Requests for Dashboard Bot

Motion lane **does not edit `package.json`**. Please add these lane test files to the
`scripts.test` strip-types list on `origin/dashboard-3d` when landing motion/+particles/:

- `src/components/mind/dashboard-3d/motion/comet-launch-ease.test.ts`
- `src/components/mind/dashboard-3d/motion/cpu-budget.test.ts`
- `src/components/mind/dashboard-3d/motion/focus-ring-breathe.test.ts`
- `src/components/mind/dashboard-3d/motion/star-batch.test.ts`
- `src/components/mind/dashboard-3d/particles/hacker-pass-c3.test.ts`
- `src/components/mind/dashboard-3d/particles/motion-lod.test.ts`

Lane CI locally: `node --experimental-strip-types --test src/components/mind/dashboard-3d/motion/*.test.ts src/components/mind/dashboard-3d/particles/*.test.ts`

### CPU budget c16
- Node CPU-only 10k frames @ 500 stars / 2k dust / 20 comets / 50 travelers / 30 chars / 80 edges.
- See `/workspace/audit/dashboard-3d/fleet/motion/c16/` for numbers (mean ≪ 2ms/frame).

