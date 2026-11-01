# postfx/ — Cosmos Light Bot lane

EffectComposer helpers: health-aware UnrealBloomPass tuning + color-grade ShaderPass.
Owned via `dashboard-3d-visual-light.lock` on `dashboard-3d-visual-light`.

- Painterly grain/shader stays in `universe-scene.tsx`.
- Hook (Dashboard Bot one-liners):

```ts
import { createTunedBloomPass, createColorGradePass } from "./postfx";
const bloom = createTunedBloomPass(new THREE.Vector2(w, h), tone);
composer.addPass(bloom.pass);
const grade = createColorGradePass(tone);
composer.addPass(grade.pass);
// on weather/health change:
bloom.update(tone); grade.update(tone);
```

## God-ray shafts (cycle 2, queue #11) — wire-up for Dashboard Bot

```ts
import { createGodRayPass } from "./postfx";
// Composer target needs a DepthTexture for occlusion (else luminance-only fallback):
const rt = new THREE.WebGLRenderTarget(w, h, { depthTexture: new THREE.DepthTexture(w, h) });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const rays = createGodRayPass();
rays.setDepthTexture(composer.readBuffer.depthTexture, camera); // RenderPass draws into readBuffer
composer.addPass(rays.pass); // before bloom/grade
// per frame / on data:
rays.setSun(orchestratorSunWorldPos, camera);
rays.update({ healthy, total, reducedMotion, tone });
// unmount: rays.dispose();
```

Off (pass.enabled = false) under reduced motion, with no/zero-healthy data, or when the sun is behind the camera.

## Hacker-pass notes (cycle 2)
- All `update(tone)` calls normalize unknown/missing tone → `idle` (neutral) instead of throwing — `weather?.tone` from the API can be any string.
- `bloom.setSize(w, h)` clamps 0/NaN/huge (≤4096) — prefer it over raw `composer.setSize` for the bloom pass on resize/high DPR.
- `bloom.dispose()` / `grade.dispose()` free render targets + materials on unmount.
- Initial bloom/grade tone should be `"idle"` until data arrives (currently created as `"healthy"` in universe-scene → green before data).

## Exposure ride (cycle 3, queue #12) — wire-up for Dashboard Bot

```ts
import { createExposureRide } from "./postfx";
const ride = createExposureRide({ tone: "idle" }); // idle until real weather arrives
// on weather/health change (and optional local hour 0..23):
ride.setTarget({ tone: weather?.tone, hour: localHour, reducedMotion });
// each frame:
ride.tick(dtMs);
ride.apply(renderer, bloom); // sets toneMappingExposure + bloom.pass.threshold
// unmount: ride.dispose();
```

Eases over 400ms; snaps (static) under reduced-motion; clamps to [0.6, 1.4]; junk/missing tone → idle.

## Hacker-pass notes (cycle 3)
- After `dispose()`, god-ray `update` / `setSun` / `setDepthTexture` no-op and leave `pass.enabled = false` (StrictMode remount / late RAF must not revive a disposed ShaderPass).
- Bloom `setSize` / `update` and color-grade `update` also no-op after dispose; color-grade dispose is idempotent.

## Context-loss recovery (cycle 4, queue #13) — wire-up for Dashboard Bot

```ts
import {
  createTunedBloomPass,
  createColorGradePass,
  createGodRayPass,
  createExposureRide,
  createContextLossRecovery,
} from "./postfx";

const recovery = createContextLossRecovery({
  canvas: renderer.domElement,
  factory: () => {
    const bloom = createTunedBloomPass(new THREE.Vector2(w, h), tone);
    const grade = createColorGradePass(tone);
    const godRays = createGodRayPass();
    const exposure = createExposureRide({ tone });
    // re-add passes to composer here…
    return { bloom, grade, godRays, exposure };
  },
  initial: { bloom, grade, godRays, exposure },
});
// render loop: if (recovery.lost) return;
// unmount: recovery.dispose(); // removes listeners + disposes handles
```

On `webglcontextlost` handles are disposed and `lost` is true (honest frozen/paused state). On `webglcontextrestored` the factory rebuilds fresh passes. Listeners are removed on dispose.

## Hacker-pass notes (cycle 4)
- `createHealthAtmosphere`: `update` after `dispose` no longer resurrects FogExp2 or mutates a foreign fog (atmosphere/hacker-dispose.test).

## Hacker-pass notes (cycle — high-DPR bloom)
- `createTunedBloomPass`: EffectComposer sizes passes at `w*dpr`; the later `bloomHandle.setSize(cssW, cssH)` used to shrink bloom mips to 1/DPR² of the frame. `setSize(w, h, pixelRatio?)` now infers the composer's ratio when omitted, and composer-driven `pass.setSize` is clamped (NaN/0/huge). Test: `postfx/bloom-dpr.test.ts`.

## Focus depth falloff (`createFocusDepthPass`)
Depth-aware atmospheric falloff around the focused node: outside a thin depth band the frame desaturates, flattens and drifts toward the fog colour (max 0.42), so the focused star + Imagine card and the DOM detail card/charts read crisply. Off (no cost) with no focus. Insert **after god-rays, before bloom**:

```ts
const focusDepth = createFocusDepthPass();
composer.addPass(focusDepth.pass); // after godRays.pass, before bloom.pass
// per frame:
focusDepth.setFocus(focusedMesh?.position ?? null, camera, { reducedMotion });
focusDepth.setFogColor((scene.fog as THREE.FogExp2).color.getHex());
focusDepth.tick(dtMs);
// unmount / context loss: focusDepth.dispose();
```
