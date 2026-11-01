# particles/ — Cosmos Motion Bot lane

Instanced cosmic dust and commit→comet trails. Fleet-owned.

## Scene integration

After the universe scene is built:

```ts
import { createDustField, createCommitComets } from "../particles";

const dust = createDustField(scene, { count: 480, seed: 42 });
const comets = createCommitComets(scene, status.commits, { max: 6 });

// in rAF:
dust.update(t, reducedMotion);
comets.update(t, reducedMotion);

// on teardown:
dust.dispose();
comets.dispose();
```

Feed real commits only. Respects prefers-reduced-motion (static dust, dimmed static comets).

## Motion clock + LOD (c3)

- Every sampler maps raw `t` through `sharedMotionClock` (motion/motion-clock.ts): wall gaps >250ms
  (hidden tab, rAF pause) advance one nominal frame, so nothing teleports on resume or at the 24h fold.
- `createDustField` LOD (default on, `lod:false` to disable): active count = full × distance factor
  (camera distance from `onBeforeRender`, full ≤22u → 35% ≥70u) × frame budget (EMA governor).
  Only the active slice is written and uploaded. `handle.lod` exposes `{active, camDistance, budget}`.
- `update()` is skipped while `document.hidden`.
- New suites (`hacker-pass-c3.test.ts`, `motion-lod.test.ts`) are imported by `hacker-pass.test.ts`
  so they run in `npm test` without a package.json edit.

## Comet tails (c4)

Commit comets are additive `LineBasicMaterial` arcs with a baked vertex-color fade
(`cometTailFade(u) = (1-u)^1.6`, bright head → black tail) plus a `Points` head using one shared
radial sprite (refcounted; freed 2s after the last handle disposes — `flushCometHeadSprite()` frees now).
The motion clock now keeps one anchor per time base (≤4) and caps stutters at 250ms.

## Hacker c5

- `dust.update(..., reducedMotion=true)` mid-session restores **full** rest poses (LOD must not leave a
  thinned static field). `dispose()` clears `onBeforeRender` so an unmounted mesh cannot keep writing LOD.

## Wind gust (c13)

`createDustField` handle gains `impulseGust(dx,dy,dz,strength?)` + `gust` sample. Call on comet/landing
events; `update` decays. Existing `update(t, reducedMotion)` signature unchanged.

