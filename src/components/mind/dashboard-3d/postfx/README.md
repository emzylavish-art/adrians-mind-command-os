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

## Hacker-pass notes (cycle — Nov 1 2026 late)
- **Ping-pong flat depth** (`depth-validity.ts`): only the composer target RenderPass just drew holds scene depth; every ShaderPass that writes a target auto-clears it to the quad's constant depth. With god-rays enabled (any healthy bot), focus-depth read the swapped target's flat depth → one band weight for every pixel → the focused Imagine card was muted along with the whole frame (or nothing was). Lane passes now mark the target they write with `renderer.info.render.frame`; a consumer whose readBuffer was written in the immediately preceding render call falls back to its radial mask. No wiring change. Test: `postfx/depth-validity.test.ts`.
- **Exposure ride crawl**: universe-scene calls `setTarget` every frame; an unchanged target used to restart the 400 ms ease each frame (~0.5%/frame, ~10 s crawl). Test: `postfx/exposure-retarget.test.ts`.
- **UnrealBloom high-pass leak**: three r187 `UnrealBloomPass.dispose()` skips `materialHighPassFilter`; `createTunedBloomPass().dispose()` now frees it (one program leaked per context-loss rebuild / unmount).

## Focus-aware bloom guard (`createFocusBloomGuard`, queue #57)
While a node is focused, masks the bloom SOURCE (luminosity high-pass) inside the focus band so Imagine portrait/card highlights don't haze over detail; background keeps tone bloom. Uses scene depth when valid, else a radial disc around the focused node sized by `radiusUv`. With no focus the original high-pass material is swapped back (zero cost). Reduced motion snaps (static).

```ts
const bloomGuard = createFocusBloomGuard(bloomHandle); // or the UnrealBloomPass
// per frame, next to focusDepth.setFocus:
bloomGuard.setFocus(focusedMesh?.position ?? null, camera, {
  reducedMotion,
  radiusUv: projectedRadiusUv(focusedMesh.position, nodeAndCardRadiusWorld, camera) ?? undefined,
});
bloomGuard.tick(dtMs);
// context-loss factory: return { ..., bloom: nextBloom, focusBloomGuard: createFocusBloomGuard(nextBloom) }
// unmount: bloomGuard.dispose() (also auto-tears down if bloom is disposed first)
```
Also add `postfx/depth-validity.test.ts`, `postfx/exposure-retarget.test.ts`, `postfx/focus-bloom-guard.test.ts` to `npm test`.

## Hacker-pass notes (#60 cycle) — context-loss never freezes on a throwing dispose/rebuild
- Before: `disposeBundle` called each handle's `dispose()` in sequence with no isolation, and `onRestored` ran it again before `factory()`. One throwing dispose (or a throwing factory) aborted the chain: later handles' render targets leaked and `lost` stayed `true` forever. universe-scene returns early from the render loop while `postfxRecovery.lost`, so the dashboard froze permanently on the last-frame snapshot with the error only reaching window.onerror.
- Now: refs are cleared before disposal, every dispose is isolated, failures go to `opts.onError(stage, err)` (default `console.error`) and `recovery.lastError`; a throwing factory still clears `lost` (loop resumes with nullish handles → existing `?? handle` fallbacks) and leaves an empty bundle. Test: `postfx/context-loss-throw.test.ts`.
- Wiring (optional): `createContextLossRecovery({ ..., onError: (stage, e) => reportDashboardError("postfx-" + stage, e) })`.

## #60 Detail-card backdrop dim (postfx) + Imagine portrait colour bounce (atmosphere) — wire-up for Dashboard Bot

```ts
import { createDetailBackdropDimPass, projectedRadiusUv } from "./postfx";
import { createPortraitBounce, portraitTextureOf } from "./atmosphere";

// Composer: AFTER grade, BEFORE kit.painterlyPass (dims final-tone brightness only).
const detailDim = createDetailBackdropDimPass();
composer.addPass(detailDim.pass);
// include in rebuildPostfxBundle()'s return: { ..., detailDim } (context-loss disposes it)

// Scene light (re-create on webglcontextrestored like focusLight):
let portraitBounce = createPortraitBounce(scene);

// Per frame, inside the Light #56 focus block:
const tex = focusedVis ? portraitTextureOf(cardPlaneOf(focusedVis).material) : null; // card plane's ImagineNode material
portraitBounce.setFocus(focusedVis ? { position: focusedVis.mesh.position, camera: camera.position, texture: tex } : null, { reducedMotion });
portraitBounce.tick(dtMs);

// Whenever detail card / chart opens, closes, resizes, scrolls (CSS px, canvas client rect):
const vp = renderer.domElement.getBoundingClientRect();
detailDim.setRects([detailCardEl?.getBoundingClientRect(), chartEl?.getBoundingClientRect()], vp, { reducedMotion });
// Keep the focused portrait undimmed if it sits under the card (#57 radius):
detailDim.setHole(focusedVis?.mesh.position ?? null, camera, focusedVis ? projectedRadiusUv(focusedVis.mesh.position, cardRadiusWorld, camera) : null);
detailDim.tick(dtMs);
// unmount: detailDim.dispose(); portraitBounce.dispose();
```

- Bounce colour comes ONLY from the loaded texture's pixels (16×16 downsample, alpha-weighted, linear). Unloaded / missing / tainted (CORS) → neutral white fill; failures land on `portraitBounce.lastSampleError`. Cached per texture+version (one readback per portrait).
- Bounce intensity 3.2 (vs #56 key 12 / rim 14) — fill only. Reduced motion snaps level + colour.
- Dim: luminance-weighted (pixels below 0.12 luma untouched, ≥0.55 dimmed up to 50%), 28px CSS feather, 10px pad, ≤2 rects. Rects are CSS px → DPR/resize safe; pass disabled (zero cost) with no rects. Eases 220ms; reduced motion snaps.
- Tests to add to `npm test`: `postfx/{context-loss-throw,detail-backdrop-dim}.test.ts`, `atmosphere/portrait-bounce.test.ts` (plus the #57 list: `postfx/{depth-validity,exposure-retarget,focus-bloom-guard}.test.ts`).

## #68 Measured-luminance backdrop dim + WCAG contrast check — wire-up for Dashboard Bot

Builds on the #67 `detailDim` handle already wired in universe-scene. Additive: with no contrast target the pass behaves exactly like #67 (static `DIM_MAX`).

```ts
import { parseCssColor } from "./postfx";

// When the detail card / charts panel opens (and on theme change), protect its real text colour:
const cs = detailEl ? getComputedStyle(detailEl) : null;
const text = parseCssColor(cs?.color);            // junk → null → static #67 dim (never guessed)
const bg = parseCssColor(cs?.backgroundColor);    // card fill composited over the scene
liveDetailDim?.setContrastTarget(text ? { textRgb: text.rgb, cardRgb: bg?.rgb, cardAlpha: bg?.alpha } : null);
// Tab visibility (no readbacks while hidden):
document.addEventListener("visibilitychange", () => liveDetailDim?.setHidden(document.hidden));
// Debug badge (optional): liveDetailDim.contrast → { source: "measured"|"static", plan: { before, after, target, reachable }, backdropLum, lastError }
```

- Measurement: every 500 ms (`METER_INTERVAL_MS`) while rects are open, the dim pass downsamples its OWN INPUT (undimmed composer buffer — no feedback) under each rect into an 8×8 RGBA8 target (16 taps/texel, `createRegionReader`) and reads it back with `readRenderTargetPixelsAsync` (sync fallback). Worst case = p90 relative luminance across rects.
- `dimForContrast` finds the SMALLEST dim (≤ `DIM_MEASURED_MAX` 0.7) giving WCAG ≥ 4.5:1 (`WCAG_TEXT_AA`; chart tick labels are text) for the text over card-bg-over-scene. Dark backdrop → dim 0 so Imagine scenes/portraits behind charts stay vivid; very bright nebula → stronger than #67's 0.5. `measuredStrength` compensates for the shader's luminance window.
- Honesty: no read yet / read failed / layout changed / reading older than 2 s / junk colour → `source: "static"` (#67 dim). Failures on `contrast.lastError`; hung readback times out after 2 s (never wedges). Hidden tab → no reads; reduced motion → one read per layout (static). Measured changes ease (180 ms time constant), reduced motion snaps.
- Cost: one 8×16 draw + 512-byte async read per 500 ms only while a card/chart is open; pass stays enabled at strength 0 while measuring so it can re-measure.
- GPU resources (8×16 RT, material, quad) are owned by the dim handle and freed in `dispose()` (context-loss bundle already disposes `detailDim`).
- Tests to add to `npm test`: `postfx/{wcag-contrast,backdrop-meter,detail-dim-measured}.test.ts`, `atmosphere/bounce-stale-error.test.ts`. (#57/#67 tests are already registered.)

## Hacker-pass notes (#68 cycle) — portrait-bounce `lastSampleError` was sticky
- Before: `lastSampleError` was only ever written on failure. After focusing one CORS-tainted Imagine portrait, every later focus (good portrait, no portrait) kept reporting the old SecurityError while the light used real pixels; a cached failure never re-surfaced once overwritten.
- Now it describes the CURRENT focus: cleared on a real sample / no texture, re-surfaced from the per-texture cache for a known-bad portrait. Test: `atmosphere/bounce-stale-error.test.ts`.
- Rest of the pass (resize/high-DPR bloom clamps, depth-validity, context-loss isolate+retry, health → idle on missing data, RT disposal) re-checked: no new real breakage found.

## #69 Per-rect measured dim (card vs chart) + chart-line 3:1 target — wire-up for Dashboard Bot
- #68 drove ONE strength from the worst rect, so a bright nebula behind Charts over-dimmed the Imagine scene behind the detail card. Now each rect (≤2) gets its own strength from its own measured p90; the shader takes `strength` = peak and a per-rect `rectWeight[i]` (share of peak). No measurement / no target → every rect at #67 static `DIM_MAX`, weight 1 (byte-identical to before).
- `setContrastTarget` accepts one target (all rects, #68 behaviour) or an array index-aligned with the rects passed to `setRects`; a `null` entry keeps that rect static.
- Chart rect: `{ textRgb: <tick label colour>, lines: { rgb: <series line colour> } }` — lines default to `WCAG_GRAPHIC_AA` (3:1), tick text stays `WCAG_TEXT_AA` (4.5:1); the rect uses whichever plan needs more dim. Junk line colour → text-only (never guessed).
- Example: `liveDetailDim.setRects([detailEl.getBoundingClientRect(), chartEl.getBoundingClientRect()], canvasRect)` then `liveDetailDim.setContrastTarget([{ textRgb: detailText, cardRgb, cardAlpha }, { textRgb: tickText, lines: { rgb: lineRgb } }])` (colours via `parseCssColor(getComputedStyle(el)...)`).
- `contrast.perRectPlans` / `contrast.perRectStrength` report each rect honestly; `contrast.plan` is the worst rect's plan.
- Register tests: `postfx/detail-dim-per-rect.test.ts`, `postfx/meter-sample-age.test.ts` (plus the #68 list).

## Hacker-pass notes (#69 cycle) — backdrop meter counted slow readbacks as fresh
- Before: a measurement's age started when the async readback LANDED, so a readback stalled 1.9 s (driver stall / context trouble) counted as fresh for another 2 s — the dim acted on a backdrop up to ~4 s old, contradicting the "older than METER_MAX_AGE_MS → static" contract. `reset()` also left the previous layout's `lastError` showing.
- Now age is measured from the sampled frame; a readback landing after max age is rejected with `lastError = "stale-readback"`; `reset()` clears `lastError`. Test: `postfx/meter-sample-age.test.ts` (fails 3/3 on the old code).

### #80 — meter readback cost guard (backdrop-meter.ts)

Every readback's real begin→resolve time is recorded (`meter.backoff.lastLatencyMs`, null until a read lands — never estimated). A read slower than `METER_SLOW_READ_MS` (33 ms), a frame ≥ `METER_DROP_FRAME_MS` (50 ms) while a read is in flight (fed by `tick(dtMs)` → `meter.noteFrame`), or a readback timeout doubles the sampling interval up to `METER_MAX_BACKOFF`× (8× → 4 s). Reads at or under `METER_FAST_READ_MS` (17 ms) halve it back. The state is surfaced on `dim.contrast.backoff` (`multiplier`, `intervalMs`, `lastLatencyMs`, `reason`) for debug badges; it survives `reset()` because it describes the device's GPU, not the layout. No wiring change needed: it is live wherever the #68 dim pass already ticks.

Hacker pass (same cycle): a resolve whose `nowMs` is before the sampled frame (mixed `Date.now`/`performance.now` clocks, injected clocks) produced a negative age that counted as fresh — forever. Now rejected as `lastError: "clock-skew"`, `measurementFor` never returns a measurement for a time before it was sampled, and `due` re-arms instead of stalling on a backwards clock (`meter-backoff.test.ts`).
