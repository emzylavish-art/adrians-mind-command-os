# Painter → Dashboard Bot wiring

Lane isolation: Cosmos Painter Bot ships modules only under `shaders/` + `materials/`.

## Status vs origin/dashboard-3d (verified cycle 21)

| API | Status | Evidence |
|-----|--------|----------|
| `createPainterlyKit` + `painterlyPass` | **done** | `universe-scene` creates kit, `composer.addPass` |
| `createSkyMaterial` | **done** | sky mesh (may swap to Imagine backdrop) |
| `createBotStar` | **done** | `rebuildBots` |
| `createImagineNodeMaterial` / `setImagineNodeMap` | **done** | portraits, characters, scene arts |
| `lane`/`health`/`loading` on Imagine + `setImagineNodeLaneWash` | optional c18 | missing-art wash from real bot lane+health; `beginImagineNodeMapBind` + `setImagineNodeMapIfGeneration` for TextureLoader races; `setImagineNodeMapFailed` on 404 |
| `createBuildingBrushPool` post-dispose tombstone | optional c17/c18 | pool safe after dispose; city may adopt |
| `textureBudget()` hysteresis | done in kit | degrade enter immediate; exit after 8 under-budget frames ×0.92 |
| `createLorePlaqueMaterial` + text atlas | **done** | lock notes plaques |
| `claimedAt` / `setLorePlaqueLockAge` + `setLorePlaqueNotesCached` | optional c19 | ink density+paper from real lock claimed_at; atlas fingerprint skips heartbeat churn |
| `createInkEdges` | **done** | `rebuildEdges` (Dashboard Bot wired) |
| `createLaneNebulae` | **done** | `rebuildNebulae` (Dashboard Bot wired) |
| `setPassHealth` / `resizePass` | **done** | frame loop + `onResize` |
| `createBuildingBrushMaterial` (+ c10 `uWindowGlow`) | **done** | `city-layer` rebuild with real `lit/floors` |
| `tickPainterlyKit(kit, t, { reducedMotion })` | **done** | `universe-scene` always calls each frame with `{ reducedMotion }` (never skipped); flushes throttled resize |
| `setBuildingProgress` | **done** | create + `city.applyBuildingProgress` on live litFloors; `progressKnown` false → 0 |
| `setBuildingWindowGlow` | optional | progress already drives glow |
| `attachPainterlyContextHandlers` | check scene | confirm detach on unmount |


## Needed for visuals to appear (c12–c19 → Dashboard Bot)

Zack asked Dashboard Bot to wire these. Until they land in `universe-scene` / city, the painter upgrades stay **inert defaults** (lane still ships them).

| Hookup | Why it must be wired | Call site |
|--------|----------------------|-----------|
| **Star health granulation (c12/c15)** | `createBotStar({ health: bot.health, idle })` — without `health`, only idle/active halo+grain ladder; blocked pigment never settles. | `rebuildBots` → `kit.createBotStar({ color: HEALTH_COLOR[bot.health], idle: bot.health==="idle", health: bot.health })` |
| **Imagine lane / health / loading (c18)** | Missing-art wash stays flat grey accent unless `lane`+`health`+`loading` passed. | `kit.createImagineNodeMaterial({ lane: bot.lane, health: bot.health, loading: true, accent: color })` |
| **Imagine async generation binds (c18)** | Rapid TextureLoader / 404 can apply **stale** maps or leave `loading` forever. | `const gen = beginImagineNodeMapBind(mat); loader.load(url, tex => setImagineNodeMapIfGeneration(mat, tex, gen, { maxTextureSize }), undefined, () => setImagineNodeMapFailed(mat, "load-failed"))` |
| **Lore `claimedAt` + age/notes cache (c19)** | Ink density/paper stay neutral; heartbeats realloc atlases without cache. | `createLorePlaqueMaterial({ claimedAt: bot.lock?.claimed_at, accent });` each poll: `setLorePlaqueLockAge(mat, bot.lock?.claimed_at); setLorePlaqueNotesCached(mat, notes, { owned: true })` |
| **Lore plaque stack (c20)** | Overlapping plaques at one star z-fight without stack index. | `createLorePlaqueMaterial({ stackIndex });` or `setLorePlaqueStackIndex(mat, i, mesh)` |
| **`createBuildingBrushPool` (c17)** | Per-building mats OOM/stall at city scale. | City rebuild: `const pool = createBuildingBrushPool({ floors }); mesh.material = pool.materialForProgress(p); pool.syncFromProgresses(list)` |
| **`textureBudget()` degraded (c17/c18)** | Soft cap was silent; now `kit.budgetMeta.degraded` eases grain/fiber — surface in UI/debug. | Once/frame or on rebuild: `const b = kit.textureBudget(); if (kit.budgetMeta.degraded) /* badge */` |
| **Star corona matte (c21)** | Without `matte`/`health`/`idle`, defaults still bloom-safe (`uMatte≈0.85`); pass real idle for quieter corona. | `kit.createBotStar({ …, idle, health, matte? })` — already on createBotStar path |
| **Ink edge `weight` (c13)** | Bleed stays kind/health default; activity-weighted watercolor needs real weight. | `kit.createInkEdges(edges.map(e => ({ …, weight: e.activity })))` |
| **Composer RT type (c20)** | Half-float unsupported / MSAA mismatch → black painterly pass. | `const rt = resolvePainterlyRenderTargetType({ halfFloatSupported: probeHalfFloatRenderTargetSupport(gl) }); new EffectComposer(renderer, new WebGLRenderTarget(w,h,{ type: rt.type }))` |

```ts
// Minimal “visuals appear” kit usage (imports from materials/index)
import {
  beginImagineNodeMapBind,
  setImagineNodeMapIfGeneration,
  setImagineNodeMapFailed,
  setLorePlaqueLockAge,
  setLorePlaqueNotesCached,
  setLorePlaqueStackIndex,
  createBuildingBrushPool,
  resolvePainterlyRenderTargetType,
  probeHalfFloatRenderTargetSupport,
} from "@/components/mind/dashboard-3d/materials";
```


```ts
import {
  createPainterlyKit,
  tickPainterlyKit,
  disposePainterlyKit,
  attachPainterlyContextHandlers,
  setImagineNodeMap,
} from "@/components/mind/dashboard-3d/materials";

const kit = createPainterlyKit({ pass: { amount: 0.42 } });
composer.addPass(kit.painterlyPass);
const detachCtx = attachPainterlyContextHandlers(renderer.domElement, kit);
// WIRED: stars kit.createBotStar; sky kit.createSkyMaterial; lore; Imagine; inkEdges; laneNebulae
// WIRED: kit.setPassHealth({ healthy, total, reducedMotion }); kit.resizePass(w,h,dpr)
// WIRED: tickPainterlyKit(kit, t, { reducedMotion }); // always — never skipped (c42c/c52)
// WIRED: setBuildingProgress via city.applyBuildingProgress (real lit/floors; unknown→0)
// cleanup: detachCtx(); disposePainterlyKit(kit);
```

Replace inlined `PainterlyShader` / `makeStarSpriteTexture` / `makeNebulaTexture` / paint cards once imported.

## c3 — ink-wash constellation edges (Dashboard Bot: universe-scene.tsx `rebuildEdges`)

Replace the `THREE.Line` + `LineBasicMaterial` edges with ribbons:

```ts
import { buildInkWashRibbon, releasePainterlyMaterial } from "@/components/mind/dashboard-3d/materials";
// teardown loop: if (ch instanceof THREE.Mesh && ch.userData.inkEdge) {
//   ch.geometry.dispose(); releasePainterlyMaterial(kit, ch.material as THREE.ShaderMaterial); }
const geo = buildInkWashRibbon(a, b, { width: e.kind === "hub" ? 0.22 : 0.34, segments: 24, arc: 0.05 });
const mat = kit.createInkWashEdgeMaterial({ health: e.health, pulse: e.kind === "hub" ? 0.2 : 0.45 });
const mesh = new THREE.Mesh(geo, mat); mesh.userData.inkEdge = true; mesh.renderOrder = 1;
edgeGroup.add(mesh);
```

- MUST use `releasePainterlyMaterial` (not bare `.dispose()`) for kit materials that are rebuilt per poll, or `kit.tracked` grows forever.
- `tickPainterlyKit(kit, t)` already ticks `InkWashEdgeMaterial` + `ImagineNodeMaterial`; shader time is wrapped to `PAINTER_TIME_PERIOD` (600s).
- Optional: `getMaxTextureSize` → `createPaperGrainTexture({ maxTextureSize: renderer.capabilities.maxTextureSize })`.

## c4 — context-restore rebind + Imagine node cards

- After `webglcontextrestored`, kit recreates `paperGrainTexture` / `starSpriteTexture` and calls `rebindPainterlyKitTextures(kit)` so consumers do not keep disposed texture objects (blank surfaces).
- Dashboard Bot: any `SpriteMaterial` / `MeshBasicMaterial` that assigns `kit.starSpriteTexture` or `kit.paperGrainTexture` **must** call `kit.bindSharedTexture(mat, "starSprite"|"paperGrain")`.
- Imagine portraits/characters/scenes: use `kit.createImagineNodeMaterial` instead of plain `MeshBasicMaterial({ map })`. Missing/loading art shows a watercolor wash fallback; `setImagineNodeMap(mat, tex)` when load completes. Do not dispose the TextureLoader map from the material — only `releasePainterlyMaterial` / `disposePainterlyKit`.

## c5 — Imagine texture sanitize + lore text atlas

- `setImagineNodeMap` runs `sanitizeImagineImageTexture`: rejects NaN/0/hard-max dims, exceeds `MAX_TEXTURE_SIZE` (optional downscale), NPOT → no mipmaps + clamp, cross-origin-tainted → wash fallback.
- Failures set `mat.userData.imagineMapError` (never silent). Check it when load "succeeds" visually as wash.
- Lore: `const atlas = createLoreTextAtlas(lockNotes); setLorePlaqueTextAtlas(mat, atlas, { owned: true });`
- Release/dispose plaque via `releasePainterlyMaterial` so owned atlas is freed.

## c6 — painterly post-pass health + resize harden

```ts
// each frame from real status (same healthy/total god-rays already use):
kit.setPassHealth({ healthy, total, reducedMotion });
// on window resize / DPR change:
kit.resizePass(cssWidth, cssHeight, window.devicePixelRatio);
```

- `painterlyAmountFromHealth` maps healthy/total → amount in [0.08, 0.85]; junk/empty/reduced-motion → min.
- `resizePainterlyPass` clamps 0/NaN/huge×DPR and skips identical drawing sizes (RT thrash).
- Shader construct failure → identity fallback + `userData.painterPassMeta.compileError` (not silent black).

## c7 — kit harden + one-line bot stars

```ts
// Replace MeshStandardMaterial bot cores:
const star = kit.createBotStar({ color: HEALTH_COLOR[bot.health], idle: bot.health === "idle" });
mesh.material = star.meshMaterial;
glow.material = star.glowMaterial;
// health change: star.setColor(HEALTH_COLOR[h], h === "idle" ? 0.25 : 0.9);

// StrictMode-safe: disposePainterlyKit always detaches context listeners.
// tickPainterlyKit never throws — check kit.lastTickError after a frame if diagnosing.
```

- All painter ShaderMaterials use `precision: "mediump"` (iOS Safari / WebGL1).
- Double `attachPainterlyContextHandlers` detaches the previous pair first.

## Next painter candidate
- Dashboard Bot: swap bot MeshStandardMaterial → `kit.createBotStar`; wire `setPassHealth`/`resizePass`.
- Ink-wash edges still pending scene adopt (`rebuildEdges` still LineDashed).


## c8 — one-call batched ink-wash edges (replace LineDashedMaterial)

```ts
// universe-scene.tsx rebuildEdges — replace Line + LineDashedMaterial:
const ink = kit.createInkEdges(
  edges.map((e) => ({
    from: posOf(e.from),
    to: posOf(e.to),
    health: e.health,
    kind: e.kind,
  })),
);
edgeGroup.clear(); // after disposing prior ink.handle
edgeGroup.add(ink.group);
// on status poll: ink.update(nextMappedEdges);
// cleanup: ink.dispose();  // releases 4 shared mats from kit.tracked + geos
```

- Batches by health tone → **≤4 draw calls** (not one mesh per edge).
- Skips zero-length / coincident / NaN-sanitized degenerates; truncates at `INK_EDGES_MAX` (512).
- Do **not** call `createInkWashEdgeMaterial` per edge when using `createInkEdges`.
- ~~Wire `createInkEdges`~~ — **done on origin/dashboard-3d**. WebGL feedback-loop evidence remains for god-ray/depth RT.


## c9 — texture budget + Imagine race + lane nebulae

~~Wire `createLaneNebulae` in `rebuildNebulae`~~ — **done on origin/dashboard-3d**.

```ts
const report = kit.textureBudget(); // { bytes, budget, overBudget, items }
// Late TextureLoader: setImagineNodeMap → "material-released" after releasePainterlyMaterial
```


## c10 — reduced-motion tick + city window washes + nebula flood

```ts
// Each frame (honor a11y / low-power):
tickPainterlyKit(kit, t, { reducedMotion });
// kit.lastTickUniformWrites reports cost; uTime frozen when reducedMotion.

// City buildings already use createBuildingBrushMaterial({ progress: lit/floors }).
// Window-light washes track real progress via uWindowGlow (0 when progress=0).
setBuildingProgress(mat, litFloors / floors); // also refreshes window glow
// optional lock: setBuildingWindowGlow(mat, 0.4);

// Lane nebulae: shared ≤4 mats; LANE_NEBULAE_MAX=32; NaN centers skipped.
```

## c12 — status-driven star brush-stroke halos

```ts
// Already wired via createBotStar — idle → low uHalo; active → stronger corona.
const star = kit.createBotStar({ color: HEALTH_COLOR[bot.health], idle: bot.health === "idle" });
// on health poll:
star.setColor(HEALTH_COLOR[h], h === "idle" ? 0.25 : 0.9); // also refreshes halo
// optional lock: star.setHalo(0.4);
```

## c13 — ink-edge watercolor bleed + star color sanitize

- `uBleed` on InkWashEdgeShader driven by real health severity + hub/link kind (optional `weight` on edge input). Neutral default 0.35. Already applied inside `createInkEdges` / `update` — **no extra Dashboard Bot wiring**.
- `sanitizePainterColor` / `starColorError`: empty/unknown CSS colors no longer become bright white; idle tint + explicit reason.
- Star `forceFallback` records `painterMaterialMeta.compileError` (visible idle-tint fallback, not black).
- `paintWrap` clamps large coords for mediump banding.

```ts
// Optional: pass real edge activity when available
kit.createInkEdges(edges.map(e => ({
  from: posOf(e.from), to: posOf(e.to), health: e.health, kind: e.kind,
  weight: e.activity, // optional 0..2
})));
// createBotStar already sanitizes bad colors — no wiring change.
```

## c14 — lane nebula pigment pooling + disposed-kit guards

- `uPool` / wash from real lane health inside `createLaneNebulae` (blocked pools heaviest). **No extra Dashboard Bot wiring** — already on shared mats.
- Mesh pool: `neb.update` no longer `new THREE.Mesh` every poll (flicker-safe).
- After `disposePainterlyKit`, create/bind return inert no-ops + `disposeMeta` (c15 fail-safe; no throw into live dashboard).
- Nebula wash uses period-continuous sin/cos orbit (wrap-seam safe with `sanitizeShaderTime`).

```ts
// Already wired — health drives pool automatically:
kit.createLaneNebulae(lanes.map(l => ({ health: l.health, center: l.center })));
// Post-dispose create/bind return inert no-ops + disposeMeta (c15); prefer fresh kit on remount.
```


## c15 — post-dispose fail-safe + star pigment granulation

- **Hacker:** c14 `painterly-kit-disposed` throw could crash the live dashboard when StrictMode/HMR/unmount races hit deferred `createImagineNodeMaterial` (requestIdleCallback / TextureLoader). create/bind now return inert no-op materials/handles, `console.warn` once, and set `kit.disposeMeta.postDisposeCall`.
- **Visual:** star pigment granulation from real bot health via `starGrainFromHealth` / `createBotStar({ health, idle })` / `setStarGrain`. Shader uses anisotropic fiber grain through `paintWrap` (mediump-safe; no raw `vUv*90`).
- **Wiring (optional improve):** pass real health tone for full granulation ladder:

```ts
const star = kit.createBotStar({
  color: HEALTH_COLOR[bot.health],
  idle: bot.health === "idle",
  health: bot.health, // blocked settles heaviest pigment
});
// already wired path (idle boolean only) still gets idle vs healthy grain
```

- No required Dashboard Bot change — idle boolean path already drives grain; health tone is additive.


## c16 — paper-grain fiber post-pass + NaN uniform scrub + empty lore atlas

- **Hacker:** live feeds / HMR can write NaN into pass `amount`/`grain`/`wash`/`fiber` and black the composer. `tickPainterlyPass` → `sanitizePainterlyPassUniforms` every frame. Empty lore plaques use `LORE_ATLAS_MIN` (not 512²) to stop fleet atlas growth. Context-loss handlers ignore disposed kits and scrub pass uniforms on restore.
- **Visual:** anisotropic paper-fiber direction on `PainterlyPassShader` (`fiber` uniform). Strength from real `setPassHealth` amount via `painterlyFiberFromAmount`. Neutral default `PAINTER_FIBER_DEFAULT`. Optional lock: `setPainterlyPassFiber`.
- **Wiring:** **none required** — `kit.setPassHealth` already drives amount → fiber. Light/Motion do not own paper grain (postfx README).


## c17 — building dry-brush + compile fallback + budget degrade + shared pool

- **Hacker:** (1) WebGL1/compile failure on buildings was silent/throw — now `forceFallback` + try/catch with visible idle shell. (2) Soft texture budget was report-only — `textureBudget()` now sets `budgetMeta.degraded`, warns once, eases pass grain/fiber. (3) Per-building mats at city scale — ship `createBuildingBrushPool` (≤8 shared) for Dashboard adopt. (4) `setBuildingProgress` stays alloc-free at 60Hz; also drives `uDryBrush`.
- **Visual:** dry-brush façade strokes (`uDryBrush`) from real progress via `buildingDryBrushFromProgress` / `setBuildingProgress`. Neutral 0 when progress unknown. Optional `setBuildingDryBrush` lock.
- **Wiring:** **none required** for dry-brush (already on createBuildingBrushMaterial path city uses). Optional: adopt `createBuildingBrushPool` when building count is large; poll `kit.textureBudget()` to surface degrade.


## c18 — Imagine missing-art wash + load races

```ts
const mat = kit.createImagineNodeMaterial({
  lane: bot.lane,           // real lane id
  health: bot.health,       // real health tone
  loading: true,            // honest pulse until TextureLoader settles
});
const gen = beginImagineNodeMapBind(mat);
loader.load(
  url,
  (tex) => setImagineNodeMapIfGeneration(mat, tex, gen, { maxTextureSize }),
  undefined,
  () => setImagineNodeMapFailed(mat, "load-failed"), // 404/CORS — wash stays
);
// Or sync: setImagineNodeMap(mat, tex) bumps gen so older in-flight binds are stale.
```

- Missing/loading art uses lane+health wash (`imagineWashFromLaneHealth`) — never fabricates portraits.
- Building pool: `materialForProgress` after `dispose()` returns a live tombstone (no undefined crash).
- Budget degrade: enter on overBudget; exit only after `BUDGET_HYSTERESIS_FRAMES` under `budget×BUDGET_HYSTERESIS_RATIO`.


## c19 — lore plaque ink density from real lock age

```ts
const loreMat = kit.createLorePlaqueMaterial({
  accent: HEALTH_COLOR[bot.health],
  claimedAt: bot.lock?.claimed_at, // real ISO / epoch; missing → neutral
});
// Heartbeat / poll: update age WITHOUT rebuilding atlas
setLorePlaqueLockAge(loreMat, bot.lock?.claimed_at);
// Notes: cached — identical text across heartbeats does not realloc canvas/GPU
setLorePlaqueNotesCached(loreMat, bot.lock?.notes || bot.notes || "", { owned: true });
```

- `uInkDensity` + `uPaper` from sanitized age (future/malformed/missing → neutral; never NaN/negative).
- Density saturates at stale floor — not a raw growing age counter.
- Empty notes stay honest empty atlas (LORE_ATLAS_MIN).


## c20 — constellation plaque stack z-fight + RT/logDepth harden

```ts
// Overlapping lore cards at one star:
bots.forEach((bot, i) => {
  const loreMat = kit.createLorePlaqueMaterial({
    accent: HEALTH_COLOR[bot.health],
    claimedAt: bot.lock?.claimed_at,
    stackIndex: i % 4, // distinct polygonOffset + renderOrder
  });
  const mesh = new THREE.Mesh(geo, loreMat);
  setLorePlaqueStackIndex(loreMat, i % 4, mesh);
  // …
});
// Composer (half-float fallback):
const gl = renderer.getContext();
const rtType = resolvePainterlyRenderTargetType({
  halfFloatSupported: probeHalfFloatRenderTargetSupport(gl),
});
const rt = new THREE.WebGLRenderTarget(bw, bh, { type: rtType.type, depthTexture });
composer = new EffectComposer(renderer, rt);
```

- Transparent plaques keep `depthWrite: false` (writing depth punches holes); **polygonOffset + renderOrder** separate layers.
- `uStackLift` soft paper shade by stack index.
- Lore + lane nebula get log-depth `onBeforeCompile` / shader chunks for `logarithmicDepthBuffer` cameras.
- Ink edges / nebulae use `PAINTER_RENDER_ORDER` so blend order does not flicker against lore.


## c21 — star corona bloom-safe matte (painter only)

```ts
const star = kit.createBotStar({
  color: HEALTH_COLOR[bot.health],
  idle: bot.health === "idle",
  health: bot.health,
  // matte defaults: idle 0.95 / active 0.85 — optional override
});
// star.meshMaterial.uniforms.uMatte — soft-caps pigment; glow opacity scaled
```

### For Cosmos Light Bot (do **not** edit in painter lane)

Painter now emits bloom-**safe** star cores (`uMatte`, luminance soft-cap ≤~0.98, `toneMapped:false`, premultiplied alpha). Light should:

1. **Keep** UnrealBloomPass thresholds tuned for mid-greys — do not lower threshold to “recover” old HDR fireballs (they are intentional gone).
2. If bloom looks too dim on stars after c21: prefer a **small** threshold/strength nudge in `postfx/` owned by Light — not painter HDR reopen.
3. Confirm composer still uses painter’s RT type hint (`resolvePainterlyRenderTargetType`) so half-float fallback stays honest.
4. Do **not** force `toneMapped:true` on painter star/glow materials — that washes watercolor pigment (sRGB/ACES mismatch).

Painter owns: `shaders/watercolor-star.ts`, `materials/star-surface.ts`, `painterly-bot-star.ts`, `painter-output.ts`. Light owns: `atmosphere/`, `postfx/`.


## c22 — Imagine card paper bevel under focus + DPR quality

```ts
import { setImagineNodeFocus, painterQualityFromDpr } from "./materials";

// Camera / click-and-zoom lane (do NOT edit camera here — only call this API):
setImagineNodeFocus(imagineMat, focused ? 1 : 0); // target 0..1; tick eases
// Kit tick honors DPR cheap grain path (4K fill-rate):
tickPainterlyKit(kit, t, { dpr: renderer.getPixelRatio() });
```

- Material-side bevel/deckle lift driven by eased `uFocus` (no camera/interaction edits).
- `setImagineNodeFocus` no-ops on released / disposed / swapped mats (no stuck focus after unmount).
- `uQuality` from `painterQualityFromDpr` — cheap single-tap grain when DPR ≥ ~2.75.
- Painter owns: `shaders/imagine-node.ts`, `materials/imagine-node.ts`. Camera owns focus id → calls API only.


## Needed for visuals to appear (c12–c22)

Unchanged from c20: Dashboard must adopt kit materials + `tickPainterlyKit` each frame. New for c22: pass `{ dpr }` into tick and call `setImagineNodeFocus(mat, 0|1)` when click-and-zoom focus enters/leaves an Imagine card (camera lane).


## c23 — aspect-safe Imagine deckle under non-square maps

```ts
import { setImagineNodeMap, imagineAspectFromDims } from "./materials";

// After TextureLoader:
setImagineNodeMap(imagineMat, tex, {
  maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  maxAnisotropy: gl.getParameter(gl.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1,
});
// uAspect set from real image dims; letterbox wash in bars; deckle follows content UV.
// Missing/0-height → uAspect = 1 (neutral). No camera/EXIF decode in painter lane.
```

- `imagineAspectFromDims` never NaN; clamps to [1/16, 16] (1×4000 → letterbox).
- `applyImagineSamplerSafe`: always no mipmaps + ClampToEdge + anisotropy ≤ GPU max (WebGL1 NPOT black guard).
- Painter owns: `shaders/imagine-node.ts`, `materials/imagine-node.ts`.


## c24 — city plaza watercolor ground (biggest visible win)

**REA note:** `/dashboard` on :8110 redirected to `/login` (auth on). Lane harness + code census used. Least painterly large surface: `city/city-layer.ts` MeshStandardMaterial circle + GridHelper while buildings already use brush mats.

```ts
// city/city-layer.ts (Dashboard lane — do not edit from painter):
const groundMat = kit.createCityGroundMaterial({
  base: 0x0a1020,
  ink: 0x2b3a66,
  accent: 0x8ea0ff,
  ring: 0.45,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
// REMOVE GridHelper — ink rings live in the shader
// On unmount: disposePainterlyKit(kit) OR createPainterlyKit({ disposePriorLive: true })
tickPainterlyKit(kit, t, { dpr, pauseWhenHidden: true });
```

### Hacker (c24)
- `disposePriorLive: true` on kit create — route leave/reenter without dispose was leaking live kits.
- `tickPainterlyKit` skips while `document.hidden` (rAF stop / background tab catch-up thrash).
