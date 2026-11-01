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
