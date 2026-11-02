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
- `src/components/mind/dashboard-3d/motion/health-pulse-crossfade.test.ts`
- `src/components/mind/dashboard-3d/motion/alloc-budget.test.ts`
- `src/components/mind/dashboard-3d/motion/neighbor-drift-damp.test.ts`
- `src/components/mind/dashboard-3d/motion/health-xfade-flap.test.ts` (c19)
- `src/components/mind/dashboard-3d/motion/neighbor-focus-fight.test.ts` (c19)
- `src/components/mind/dashboard-3d/motion/star-batch-xfade.test.ts` (c19)
- `src/components/mind/dashboard-3d/motion/edge-pulse-flip.test.ts` (c20)
- `src/components/mind/dashboard-3d/motion/state-prune.test.ts` (c20)
- `src/components/mind/dashboard-3d/motion/traveler-focus-churn.test.ts` (c21)
- `src/components/mind/dashboard-3d/motion/traveler-trails.test.ts` (c21)
- `src/components/mind/dashboard-3d/particles/hacker-pass-c3.test.ts`
- `src/components/mind/dashboard-3d/particles/motion-lod.test.ts`

`alloc-budget.test.ts` no longer needs `--expose-gc` (c19 enables gc at runtime via `v8.setFlagsFromString`), so it is safe in the plain strip-types chain. No new deps.

Lane CI locally: `node --experimental-strip-types --test src/components/mind/dashboard-3d/motion/*.test.ts src/components/mind/dashboard-3d/particles/*.test.ts`

### CPU budget c16
- Node CPU-only 10k frames @ 500 stars / 2k dust / 20 comets / 50 travelers / 30 chars / 80 edges.
- See `/workspace/audit/dashboard-3d/fleet/motion/c16/` for numbers (mean ≪ 2ms/frame).

## Health pulse crossfade (c17)

When bot health flips, ease pulse amp/speed instead of snapping:

```ts
import {
  createHealthPulseCrossfadeState,
  setHealthPulseTarget,
  stepHealthPulseCrossfade,
  sampleStarPulseCrossfaded,
} from "./motion";

const xf = createHealthPulseCrossfadeState(bot.health);
// on status update:
setHealthPulseTarget(xf, bot.health, reducedMotion);
// each frame:
stepHealthPulseCrossfade(xf, dt, reducedMotion);
sampleStarPulseCrossfaded(pulseOut, tmpFrom, tmpTo, xf, t, phase, reducedMotion, { clock });
```

Works alongside `stepStarFieldBatch` (per-star xf state array) and focus-ring breathe.
Reduced-motion → snap. Camera dolly remains Dashboard-owned.

### Star-batch harden (c17 hacker)

- `STAR_BATCH_MAX` (8192) hard-caps corrupt huge counts
- Null/empty id holes skipped; lengths snapshotted at entry
- `createStarBatchScratch` / `disposeStarBatchScratch` — Float32 packed bases/pos; reuse after dispose

### Health pulse crossfade wiring (c17)
- Keep one `HealthPulseCrossfadeState` per bot (parallel to focus-ease).
- On status/health change call `setHealthPulseTarget`; each tick `step` + `sampleStarPulseCrossfaded` (or lerp after dual `sampleStarPulse`).
- Register `health-pulse-crossfade.test.ts` in package.json test glob when landing (Motion lane does not edit package.json).

## Neighbor drift damp (c18)

After focus-ease / star-batch, soft-dampen 1-hop neighbors:

```ts
import {
  collectOneHopNeighbors,
  stepNeighborDriftDampBatch,
} from "./motion";

const neighbors = collectOneHopNeighbors(edgePairs, focusId); // rebuild when graph/focus changes
stepNeighborDriftDampBatch(ids, focusStates, focusId, neighbors, dt, reducedMotion);
// applyFocusDrift already uses focusStates[i].driftMul
```

Focused star stays fully pinned by `stepFocusEase`. Reduced-motion → neighbors get no extra damp.
Camera dolly remains Dashboard-owned.

### Alloc budget (c18 hacker)
- `STAR_BATCH_ORBIT_OPTS` reused; no per-star `{ clock, radialAmp, bobAmp }`.
- cpu-budget harness reuses opts; heapΔ budget 5MB (was ~14MB in c16).
- Run alloc-budget tests with `node --expose-gc`.

### Neighbor drift damp wiring (c18)
- Build `edgePairs` from constellation edges; `collectOneHopNeighbors(edgePairs, rig.subjectId)` when focus/graph changes.
- After star-batch / focus-ease, call `stepNeighborDriftDampBatch` so neighbor `driftMul` eases toward `NEIGHBOR_DRIFT_FLOOR`.
- Register `alloc-budget.test.ts` + `neighbor-drift-damp.test.ts` in package.json test glob when landing (Motion lane does not edit package.json).

## Star-batch xfade + neighbors (c19)

One-call wiring for the c17 health crossfade and c18 neighbor damp (both opt-in;
omit them and output is identical to c16):

```ts
import { stepStarFieldBatch, createHealthPulseCrossfadeState, collectOneHopNeighbors } from "./motion";

const xfade = bots.map((b) => createHealthPulseCrossfadeState(b.health)); // keep per bot, like focus states
const neighbors = collectOneHopNeighbors(edgePairs, focusId); // rebuild only when focus/graph changes

stepStarFieldBatch(ids, healths, bases, focusStates, pulseOuts, posOuts,
  focusId, tSeconds, dt, reducedMotion, ids.length, { clock, xfade, neighbors });
```

- Health changes are picked up from `healths[i]` each frame (no separate setter call needed).
- Reduced-motion → crossfade snaps, neighbors keep full drift.
- Hacker c19: crossfade flapping (A→B→A / A→B→C mid-blend) is now exactly continuous
  (per-health weight vector; `from/to/blend` kept as derived fields).
- Hacker c19: neighbor damp no longer fights `stepFocusEase` (settled ~0.71 instead of
  the 0.35 floor); it owns driftMul for non-focused stars via `neighborMul`.
- Star-batch no longer pins the caller's MotionClock in module scope after a frame.
- Camera dolly stays Dashboard-owned.

## Edge pulse flip + motion state prune (c20)

- Hacker c20: `stepEdgePulseSync` phase is now symmetric per edge (`edgePulsePhase(a,b)`),
  so `rig.subjectId ?? hoverId` flipping between endpoints / to null no longer pops the
  ink-edge `uPulse` (was up to ~0.19 pulse / ~0.2 uniform in one frame). API unchanged.
- `pruneMotionStateMap(map, liveIds, max?, onEvict?)` — drop per-bot motion state for
  bots that left status + hard cap (`MOTION_STATE_MAP_MAX` 4096). Call on bot-list
  change, e.g. after the rebuild that already does `focusEase.clear()`:

```ts
import { pruneMotionStateMap } from "./motion";
pruneMotionStateMap(healthXfade, liveBotIdSet); // currently never pruned in universe-scene
```

`liveIds == null` (failed fetch) only enforces the cap — it never wipes all state.

### c50 wiring note (from c19 fixes)
- Your post-batch `stepNeighborDriftDampBatch` now settles neighbors at the 0.35 floor
  (was ~0.71) with no change on your side.
- `STAR_BATCH_ORBIT_OPTS.clock` is reset to `undefined` after each batch; your post-batch
  orbit re-sample still uses `sharedMotionClock` via the default. Passing
  `{ clock, xfade, neighbors }` to the batch lets you delete that re-sample and the
  separate crossfade loop (queue #79).

## Traveler focus churn + trail batch (c21)

- Hacker c21: `stepTravelerEase` resume no longer snaps to absolute clock phase. While the
  shared clock kept advancing during a pause, the first resumed frame teleported the marker
  (measured 0.40 lap after a 4s pause) and opacity popped 0.55↔1 in one frame; reduced-motion
  also silently cleared `paused`. Now: resume re-anchors from the frozen progress
  (`phaseOffset`, folded into `[0,duration)`), the paused dim eases (τ 0.18s, clock-mapped
  dt), reduced-motion keeps `paused` and leaving it continues from the static pose. New
  state fields are optional; API and call sites unchanged.
- `stepTravelerTrails(trails, t, dt, reducedMotion, { hold })` — one call replaces the
  per-trail loop in universe-scene and returns the count of **genuine** forward loop wraps
  (`isTravelerWrap`: small forward step across 1→0; never on hold/reduced/teleport):

```ts
import { stepTravelerTrails } from "./motion";
// landingTrails entries already have { ease, sample, points, lastProgress }
const wraps = stepTravelerTrails(landingTrails, t, dt, reducedMotion, {
  hold: detailOpen || fly.flying, // optional scene-wide hold; never resumes a caller-owned pause
});
if (wraps > 0) dust.impulseGust(0.55, 0.12, -0.35, 0.45);
for (const tr of landingTrails) { /* mesh.position / opacity / visible from tr.sample as today */ }
```

Capped at `TRAVELER_TRAILS_MAX` (256). Zero per-frame alloc. No new deps.
Queue rows: #90 (wire, Dashboard) and #91 (Motion c22 probe) — numbered past local c52 #83–#89; renumber freely on landing.

## Comet churn + character re-entry (c22)

- Hacker c22 (#91): universe-scene's 5s sync does `clearCometLaunch` + `scheduleCometLaunchBurst`
  after rebuilding comets, so **every landed comet blinks to opacity 0 and re-launches every
  5 seconds even when the commit list is unchanged** (reproduced in `comet-churn.test.ts`).
  The head size line `mat.size = max(0.12, mat.size * (0.85 + 0.15 * scale))` also compounds
  per frame: each launch shrinks the head permanently and the 5s relaunch pins every head at
  the 0.12 floor.
- `reconcileCometLaunch(state, keys, reducedMotion, opts?)` — keyed by commit sha per slot:
  unchanged key → untouched (landed stays at 1, in-flight keeps easing); new/changed key →
  staggered launch (maxConcurrent respected; overflow parks visible, never hidden forever);
  gone/empty key → hidden. Key compare capped at 128 chars. Legacy states adopt `keys`.
- `cometHeadSize(baseSize, sample, reducedMotion)` — non-compounding; `particles/commit-comets`
  now stores `head.userData.baseSize` and exposes `handle.shas`.
- Character: `stepCharacterMotion` state gains optional `amp`; reduced-motion parks it at 0
  and leaving reduced eases bob/breath back in (λ 6) instead of popping to full amplitude.
  dt=0 resamples hold. No call-site change.

```ts
// init and in the 5s sync, after createCommitComets:
reconcileCometLaunch(cometLaunch, comets.shas ?? [], reducedMotion); // replaces clear+schedule
// per frame, head:
mat.size = cometHeadSize(head.userData.baseSize as number, sample, reducedMotion);
```

### Requests (c22)
- Register in package.json `test` (strip-types list):
  `src/components/mind/dashboard-3d/motion/comet-churn.test.ts`. No new deps.
- Queue row #96 (wire). Renumber freely on landing.

## Comet sync without GPU churn + sha-stable orbits (c23)

- Hacker c23: the scene's 5s sync still does `comets.dispose(); comets = createCommitComets(...)`
  **unconditionally** — every 5s, 2 geometries + 2 materials per comet are freed and re-created
  (12 GPU resources for 3 comets, reproduced in `particles/comet-sync.test.ts`) even when the
  commit list is unchanged. Disposing the last vertex-colored LineBasicMaterial / PointsMaterial
  lets three release the shader programs, so the next frame recompiles + re-uploads: a periodic
  hitch with nothing new to draw.
- `syncCommitComets(scene, prev, commits, opts)` — returns `prev` untouched when the derived
  comet list (`commitCometKeys`) and options are unchanged; else disposes `prev` and rebuilds.
- Orbits now derive from the sha (`cometOrbitForSha`), not the list index: a new commit no
  longer moves every existing comet to another orbit. `reconcileCometLaunch` now follows a key
  that moved index (carries landed / in-flight state), so a prepended commit launches **one**
  comet instead of re-launching all six. Duplicate shas (same commit in two feeds) draw once.
  Sha keys capped at `COMET_SHA_KEY_MAX` (128); feed scan bounded (4096 rows).
- API: `createCommitComets` / `reconcileCometLaunch` signatures unchanged. New exports from
  `./particles`: `syncCommitComets`, `commitCometKeys`, `cometOrbitForSha`, `COMET_SHA_KEY_MAX`,
  `type CometOrbit`.

```ts
import { createCommitComets, syncCommitComets, createDustField } from "./particles";
// in the 5s sync (progressive-WebGL `comets` may be null) — replaces
// `comets.dispose(); comets = createCommitComets(...)`:
if (comets) {
  comets = syncCommitComets(scene, comets, dataRef.current.commits, { max: 6 });
  reconcileCometLaunch(cometLaunch, comets.shas ?? [], reducedMotion); // no-op when unchanged
}
```

Same pattern (not motion lane, FYI): the 5s sync also disposes + recreates `inkEdges`,
`laneNebulae` and `feedGlyphs` unconditionally.

Optional perf nit for the per-frame comet loop (Dashboard-owned): **done in motion c24** —
`applyCometLaunchSamples(handle, samples, reducedMotion)` uses `handle.lines` / `handle.heads`
(filled by `createCommitComets`, cleared on dispose). Zero `getObjectByName` per frame.
Wire: replace the scene's per-comet name walk with one call after `stepCometLaunchEase`.

### Requests (c24)
- Register in package.json `test` (strip-types list):
  `src/components/mind/dashboard-3d/particles/comet-apply.test.ts`,
  `src/components/mind/dashboard-3d/particles/null-opts.test.ts`,
  `src/components/mind/dashboard-3d/motion/traveler-holes.test.ts`. No new deps.
- Queue row #108 (wire). Renumber freely on landing.

### Requests (c23)
- Register in package.json `test` (strip-types list):
  `src/components/mind/dashboard-3d/particles/comet-sync.test.ts`. No new deps.
- Queue row #102 (wire). Renumber freely on landing.

### Requests (c25)
- Wire `stepStarFieldBatch(..., { stillTarget: true })` (or call `stepFocusStillTarget` per focused star after pulse sample).
- Register in package.json `test` strip-types list:
  `src/components/mind/dashboard-3d/motion/focus-still-target.test.ts`,
  `src/components/mind/dashboard-3d/particles/comet-stale-cache.test.ts`. No new deps.
- Queue row #111 (wire). Hacker c25: applyCometLaunchSamples skips null/hole/missing-material cache slots; dispose null-safe.

## Requests for Dashboard Bot (c26 — reduced-motion freeze audit)

Motion lane freeze-audit tests (`motion/reduced-freeze-audit.test.ts`) prove
`motion/` + `particles/` outputs are **bit-stable** across 60 frames at
`reducedMotion=true` (star-batch, dust, comets, launch apply, travelers, character,
edge, ring, gust, hover, still-target). **No motion/particles fix** — residual REA
canvas motion is outside this lane.

### Evidence
- REA reduced uniqueSamples **before**: c24=4, c25=6.
- REA reduced uniqueSamples **after** (c26 lean, 960×540, 6s settle, 6 canvas JPEG
  samples @150ms): **4** (lens 37007/37067/37087/37087/37163/37163). Same floor as
  c24; not improved because source is Dashboard-owned scene churn.
- Full-page pixel-region diff (5 frames @200ms): 2 hot 8×8 cells near mid/lower
  canvas (≈360–600×268–402) with small maxd — consistent with late progressive mount
  / camera projection, not particle twinkle.
- Progressive mount: `hasCanvas` false at t=6s meta, canvas present by probe — heavy
  layers still landing under reduced.

### Trace (do not edit from Motion)
1. **`universe-scene.tsx` 5s sync** (`now - sync > 5000`): `rebuildAll()`, `syncCity()`,
   disposes `inkEdges` / `laneNebulae` without recreate, recreates `feedGlyphs`.
   Under reduced (no composer) this still mutates WebGL and explains multi-sample
   canvas JPEG deltas. **Owner: Dashboard Bot.** Skip rebuild/dispose thrash when
   `reducedMotion`, or recreate disposed layers; ideally no scene-graph churn while
   reduced.
2. **Progressive `mountHeavyLayers` / `scheduleHeavy`** — late dust/comets/city mount
   changes canvas after first paint. **Owner: Dashboard Bot.** REA wait until
   `heavyMounted`.
3. **`stepRigSmooth` while `rig.t < 1`** still runs under reduced (fast-forward dt).
   Multi-frame camera ease changes every mesh projection. **Owner: Dashboard Bot**
   (`camera-rig` / universe tick). Prefer snap (`rig.t = 1`) when reduced.
4. **Billboard `cardGroup` `lookAt(camera)` every frame** — couples to (3).
   **Owner: Dashboard Bot.**

Painter `tickPainterlyKit` correctly freezes `uTime` under reduced. Light postfx
bundle is not built when reduced (`composer` null) — not the REA canvas source.

### Requests (c26)
- Register `src/components/mind/dashboard-3d/motion/reduced-freeze-audit.test.ts`
  in package.json strip-types test list. No new deps.
- Queue row #113: Motion c26 freeze-audit **done** (lane-side); Dashboard owns the
  universe-scene reduced static scene request above.

## Requests for Dashboard Bot (c27 — reduced-motion guard + settle gate)

Pure helpers in `motion/reduced-motion-guard.ts` (exported from `motion/index`).
**Do not re-litigate c26 findings** — this is the drop-in wrap for the four
residual sources. Motion lane never edits `universe-scene.tsx`.

```ts
import {
  createReducedMotionGuard,
  hashMotionLaneSnapshot,
  observeReducedMotion,
  shouldMountHeavy,
  shouldRebuildScene,
  snapRigProgress,
  stepReducedMotionSettle,
} from "./motion";

// once per UniverseScene mount:
const rmGuard = createReducedMotionGuard();
const rmSub = observeReducedMotion((matches) => { reducedMotion = matches; });
// on unmount: rmSub.disconnect();

// each status / commits payload (cheap content digest):
const dataHash = hashMotionLaneSnapshot({
  bots: botVis.map((b) => [b.id, b.health, b.base]),
  commits: dataRef.current.commits?.map((c) => c.sha) ?? [],
  focusId: rig.subjectId,
});
```

### 1. 5s sync / `rebuildAll` / dispose thrash
```ts
// inside the 5s sync tick, BEFORE rebuildAll / inkEdges.dispose / feedGlyphs recreate:
stepReducedMotionSettle(rmGuard, reducedMotion, performance.now());
if (!shouldRebuildScene(rmGuard, dataHash, reducedMotion, performance.now())) {
  // same data under reduced — skip rebuildAll + layer dispose/recreate
  return;
}
rebuildAll();
// …syncCity / recreate disposed layers only when rebuild was allowed
```

### 2. Progressive `mountHeavyLayers` / `scheduleHeavy`
```ts
function scheduleHeavy() {
  if (!shouldMountHeavy(rmGuard, reducedMotion)) return; // one shot under RM
  mountHeavyLayers();
}
```

### 3. `stepRigSmooth` while `rig.t < 1`
```ts
// each rAF, before or after stepRigSmooth:
snapRigProgress(rig, reducedMotion); // forces rig.t = 1 under RM (instant camera)
if (!reducedMotion) stepRigSmooth(rig, dt);
```

### 4. Billboard `cardGroup.lookAt(camera)`
```ts
// only lookAt when the camera may still be moving:
if (!reducedMotion || rig.t < 1) {
  cardGroup.lookAt(camera.position);
}
// with snapRigProgress above, under RM this becomes a single post-snap lookAt
```

### REA / freeze assert
```ts
// After settle, lane-side freeze is independent of scene rebuild thrash:
const a = hashMotionLaneSnapshot(laneSample);
const b = hashMotionLaneSnapshot(laneSample);
assert(a === b);
```

### Requests (c27)
- Register `src/components/mind/dashboard-3d/motion/reduced-motion-guard.test.ts`
  in package.json strip-types test list. No new deps.
- Wire the four call-sites above in `universe-scene.tsx` (Dashboard Bot).
- Queue row #115: Motion c27 **done** once landed.

## Requests for Dashboard Bot (c28 — RM guard harness)

Lane-side proof that the c27 guard cuts rebuild churn:

```ts
import { runReducedMotionGuardHarness, hashMotionLaneSnapshot } from "./motion";

const report = runReducedMotionGuardHarness({
  durationMs: 5000,
  frameMs: 100,
  reducedMotion: true,
  payloadAt: (t) => ({ /* same shape you feed shouldRebuildScene */ }),
});
// stable payload → report.rebuildCount === 1, heavyCount === 1, finalRigT === 1
// one mid-window change → rebuildCount === 2
```

Also: `disposeReducedMotionGuard(guard)` on UniverseScene unmount (post-dispose
rebuild/heavy deny). `hashMotionLaneSnapshot` caps at `HASH_MOTION_SNAPSHOT_MAX_CHARS`
(65_536) — overflow returns a stable sentinel (no main-thread cliff).

### Requests (c28)
- Register `reduced-motion-guard-harness.test.ts` (+ ensure guard.test.ts) in
  package.json strip-types list. No new deps.
- Queue row #116 Motion c28 **done**.

## Requests for Dashboard Bot (c29 — dust mote GPU cut)

No scene wiring change. `createDustField` now uses `OctahedronGeometry(size, 0)`
(8 tris/mote) instead of `SphereGeometry(size, 6, 6)` (~60 tris) and writes
instance matrices directly into `instanceMatrix.array` (no per-mote Object3D).

Normal REA c29 justification: uniqueSamples 9/10; pixel hot mid-canvas matched
dust wobble. Field tris at default 480: **28800 → 3840** (7.5×).

### Requests (c29)
- Register `particles/dust-mote-perf.test.ts` in package.json strip-types list.
- Queue row #117 Motion c29 **done**.

## Requests for Dashboard Bot (c30 — comet arc upload throttle)

No scene wiring change. `commit-comets` `update()` now:
- skips all GPU work when `clock.map(t)` returns the same mapped time (duplicate tick)
- on real motion, marks `BufferAttribute` update ranges before `needsUpdate`
- skips redundant opacity writes

CPU arc positions stay current whenever an upload runs — visible motion matches
the pre-throttle path. Dust c29 recheck: 480×120 updates ≈0.03 ms/frame ≪ c16
0.3 ms/frame budget (not a regression).

### Requests (c30)
- Register `particles/comet-arc-upload.test.ts` in package.json strip-types list.
- Queue row for Motion c30 **done**.

## Requests for Dashboard Bot (c31 — comet segment LOD)

No required scene wiring. Comet trails read camera distance via `line.onBeforeRender`
(same pattern as dust). Optional: `comets.setCamDistance(rig.camera.position.length())`
each tick if you prefer an explicit feed.

Far camera → `drawRange` thins to `COMET_SEG_FAR_MIN` (6) with hysteresis
(`COMET_SEG_LOD_HYST`); near restores full segments. Head sample stays s=0 of the
resampled arc (no pop).

### Requests (c31)
- Register `particles/comet-seg-lod.test.ts` in package.json strip-types list.
- Queue row #120 Motion c31 **done**.

## Requests for Dashboard Bot (c32 — glow scale cap)

Painter c26: additive glow saturated watercolor stars. Motion-side only:
- `GLOW_BASE` 2.0 → **1.25** (`star-pulse.ts`)
- `out.glow` (→ `n.glow.scale`) hard-capped at **`GLOW_SCALE_CAP` = 1.45** via `clampGlowScale`
  after pulse + `applyFocusPulse` (star-batch also clamps).

No universe-scene edit. Pulse / breathe / focus multipliers still apply inside the cap.

### Requests (c32)
- Register `motion/glow-scale-cap.test.ts` in package.json strip-types list.
- Queue row for Motion c32 **done**.
