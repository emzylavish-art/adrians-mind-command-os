# Painter → Dashboard Bot wiring

Lane isolation: Cosmos Painter Bot ships modules only under `shaders/` + `materials/`.

## Still unwired (Dashboard) — prioritized (2026-11-03T00:06:27+01:00 WAT, origin/dashboard-3d@899f896)

| Pri | Adopt | Status | Evidence | First noted |
|-----|-------|--------|----------|-------------|
| **P0** | **c30 kit.createNotionGalaxyPages** | **READY — UNWIRED** | Material shipped this cycle; universe-scene rebuildPages still MeshBasic interim (c68) | 2026-11-03 |
| P1 | Landing-trail travelers | **UNWIRED** | MeshStandardMaterial gold spheres | 2026-11-02 |
| P2 | Optional Imagine lane wash on every card | partial | map bind wired | 2026-11-01 |
| — | c27 fleet beacon / c24 ground / c25 sun / c26 emissive / c22 focus+DPR / c19 lore claimedAt / Motion c32 | **WIRED** | — | done |

### → Dashboard Bot (P0)
Replace MeshBasic rebuildPages with:

```ts
let galaxy: ReturnType<typeof kit.createNotionGalaxyPages> | null = null;
function rebuildPages(status: DashboardStatus) {
  const pages = status.notionGraph.pages.map(p => ({ id: p.id, kind: p.kind }));
  const edges = status.notionGraph.edges; // kind === "child" filtered inside
  if (!galaxy) {
    galaxy = kit.createNotionGalaxyPages(pages, edges, { layoutRadius: 16 });
    pageGroup.add(galaxy.group);
  } else {
    galaxy.update(pages, edges);
  }
  // focus tint: galaxy.pageMesh instanceColor — or keep tintNotionNeighbors adapting to pageMesh
}
// dispose: galaxy?.dispose()
```

### → Cosmos Light Bot
No new c30 ask. Galaxy pages are matte watercolor (toneMapped:false).

### → Cosmos Motion Bot
No new c30 ask.


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


## c25 — sun watercolor surface + scoped disposePriorLive

### disposePriorLive safety (c24 fix)
`disposePriorLive` **requires** `kitScope`. Same-scope remounts dispose prior kits only.
Minimap/preview must use a different scope (`"minimap"` / `"preview"`). Without
`kitScope`, disposePriorLive is ignored (never a global wipe).

```ts
const kit = createPainterlyKit({
  kitScope: "dashboard",
  disposePriorLive: true, // only prior "dashboard" kits
});
// minimap:
createPainterlyKit({ kitScope: "minimap" });
```

### Sun (universe-scene.tsx — Dashboard lane)

```ts
// Replace MeshStandardMaterial sun:
const sun = kit.createSunMaterial({
  color: 0xffd27a,
  // health recolor:
});
sunMesh.material = sun.meshMaterial;
// on rebuild health:
sun.setColor(HEALTH_COLOR[bot.health], bot.health === "idle" ? 0.25 : 1.05);
// Optional glow sprite with sun.glowMaterial — Light owns bloom/god-rays (do not retune here).
```

Painter owns surface (`createSunMaterial` → watercolor star). Light owns bloom/emissive postfx.


## c26 — neon bot spheres: pigment map + glow setColor wipe (painter) + Motion/Light wiring

### Root cause (evidence)
1. **createBotStar IS wired** in `universe-scene.tsx` `rebuildBots` — not a missing adopt.
2. **Painter bug (fixed c26):** every-frame `n.setColor(HEALTH_COLOR[n.health], pulse.emissive)` copied **raw** status RGB onto the **AdditiveBlending** glow sprite, wiping the create-time matte `multiplyScalar(glowScale)`. Healthy `0x3dd68c` + additive scale ~`pulse.glow` (**GLOW_BASE=2.0** in Motion `star-pulse.ts`) → flat neon-green blobs; watercolor mesh + granulation unread.
3. **Painter bug (fixed c26):** `setStarWatercolorColor` / `setColor` allowed `emissive` **0..3**; Motion healthy pulse ~0.7–0.9 (blocked up to ~1.2). Pigment `uColor*(0.55+uEmissive*0.65)` blew toward LED before matte clamp.
4. Status colors are **not** pure `#00ff00` (healthy=`0x3dd68c`) but still too saturated for additive glow; pigment ramp now desats primaries/neon.

### Painter lane landed
- `painterPigmentFromStatusColor` + soft-cap `PAINTER_PIGMENT_MAX_CHANNEL`
- `sanitizePainterEmissive` → `PAINTER_EMISSIVE_MAX=1`
- `setColor` / `setMatte` re-apply **matte-scaled pigment** to glow (never raw neon)
- Quieter glow opacity; shader quieter emissive lift + tighter `bloomSafeClamp` under matte

### → Motion Bot (do not edit from painter)
**UPDATE:** GLOW_BASE→~1.25 and glow scale ≤1.45 queued as **motion c32** — do not duplicate.

`motion/star-pulse.ts`: `GLOW_BASE = 2.0` scales additive sprites 2× mesh. With many overlapping nodes this stacks to neon wash even after painter matte.

```ts
// motion/star-pulse.ts — suggest
const GLOW_BASE = 1.25; // was 2.0 — painter additive sprites already bloom
// keep GLOW_AMP ~0.15–0.25
```

`universe-scene` (Dashboard owns file): prefer not feeding raw `pulse.emissive` into `setColor` every frame once health is set — drive pulse via scale/halo only:

```ts
// universe-scene tick — prefer
n.glow.scale.setScalar(Math.min(1.45, pulse.glow) * (scaleMul / Math.max(1e-6, pulse.scale)));
if (n.setColor) n.setColor(HEALTH_COLOR[n.health]); // omit emissive; or clamp Math.min(1, pulse.emissive)
// optional: n.setHalo?.(0.2 + pulse.emissive * 0.35)
```

### → Cosmos Light Bot
Additive painter glow + UnrealBloom still saturates green if threshold is low / strength high. Do **not** lower bloom threshold to “bring back glow” after c26 — leave threshold so watercolor pigment reads; painter now soft-caps under matte.

```ts
// light bloom — keep threshold ≥ ~0.85 (or current post-c21 value); avoid strength bumps for “neon stars”
```

### → Dashboard Bot
Confirm sun adopt from c25 still pending if MeshStandard sun remains. Star path already uses `createBotStar` + `setColor` — after Motion glow-base drop, constellation should read watercolor without further Dashboard changes. Optional: pass `matte: bot.health === "idle" ? 0.95 : 0.85` explicitly.


## c27 — fleet queue/landing string-light beacons (MeshStandard → watercolor adopt)

### Evidence (c26-full-after baseline)
| Candidate | Mesh / material | Owner |
|-----------|-----------------|-------|
| Neon-green string-lights arcing across **top** | `fleet-plan-layer.ts` `rebuildQueueRoad` → `ball()` = Sphere + **MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.85 })**; done=`0x3dd68c`; `queueWaypointPositions` y≈8.8 | **Dashboard** — painter ships adopt |
| Blue boxy city cluster | `city-layer` `createBuildingBrushPool` + c24 plaza | Painter (wired) |
| Starfield | `particles/dust-field.ts` | **Motion** — do not touch |
| Nebula washes | `createSkyMaterial` + `createLaneNebulae` | Painter (wired) |

**Root cause:** queue/landing beacons still MeshStandard `emissive===color` @0.85. Not createBotStar. Motion c32 glow-base does not fix these.

### Painter lane landed
- `kit.createFleetBeacon` — pigment/matte glow, `setStatus` / `setReached`, radius sanitize
- Hacker: `#00ff00` LED, radius NaN/huge, post-dispose inert

### → Dashboard Bot
Replace `ball()` in `fleet-plan-layer.ts` (queue road + landing hops). Pass `kit` into rebuild helpers.

```ts
function ball(kit: PainterlyKit, pos: THREE.Vector3, color: number, r = 0.42,
  status: "done" | "active" | "queued" | "reached" | "pending" = "done") {
  const beacon = kit.createFleetBeacon({ color, status, radius: r });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(beacon.radius, 20, 20), beacon.meshMaterial);
  const glow = new THREE.Sprite(beacon.glowMaterial);
  glow.scale.setScalar(1.15);
  const g = new THREE.Group();
  mesh.position.set(0,0,0); glow.position.set(0,0,0);
  g.add(mesh, glow);
  g.position.copy(pos);
  g.userData.fleetBeacon = beacon;
  return g;
}
// rebuildQueueRoad: status from item.status
// rebuildLandingPaths: reached ? "reached" : "pending"
// clearGroup: dispose beacon.meshMaterial + glowMaterial
```

Notion page galaxy InstancedMesh + MeshStandard (`0x9bb7ff`) still unpainted — next adopt (instanceColor in star shader). Sun createSunMaterial now wired (dashboard c63).

### → Cosmos Light Bot
No c27 bloom change. After Dashboard adopts beacons, do not lower threshold to restore MeshStandard LEDs.

### → Cosmos Motion Bot
**No action for c27.** Glow-base/scale already **motion c32**. Dust stays your lane.

## c28 — painterly post-pass paper wash (already wired — no Dashboard adopt)

**Target:** full /dashboard still reads digital; fleet beacons need Dashboard (P0) but pass/grain/nebulae/stars are already in composer. c28 raises **PainterlyPassShader** paper grain, fiber wash, palette, ink-edge pool, and mediump-safe UV brush caps — visible without new wiring (`composer.addPass(kit.painterlyPass)` + `setPassHealth` already live).

**Hacker:** UV brush soft-cap (`PAINTER_PASS_BRUSH_OFFSET_MAX`); sample UV clamp; amount/grain NaN scrub; final rgb clamp.

### → Dashboard / Light / Motion
No new wire for the pass. P0 remains c27 fleet beacon (see Still unwired table).

## c29 — star granulation readable on wired createBotStar + pass vignette soften

**Pass check vs c26-full-after:** c28 louder wash **reads** (grain/mottle); HUD FEED/TIME/charts stay high-contrast — no major tune-back. Softened vignette floor 0.68→0.76 for corner HUD.

**Lane win:** WatercolorStar granulation + STAR_GRAIN_BY_HEALTH bump (already `createBotStar` wired). Neon spheres on full dash still looked flat after c26 pigment — grain was too quiet.

**Hacker:** uGrain clamp in pigment path; grain amp NaN-safe via existing sanitizeStarGrain.

### → Dashboard Bot
P0 remains Notion galaxy watercolor instance material (MeshBasic interim). P1 landing travelers.

### → Light / Motion
No new ask.

## c30 — Notion galaxy watercolor pages + ink child edges (adopt)

**Shipped:** `GalaxyPageShader` (USE_INSTANCING + instanceColor), `createGalaxyPageMaterial`, `kit.createNotionGalaxyPages(pages, edges)` — kind→pigment from real snapshot; child edges → ink-wash.

**Hacker:** empty/huge page lists, NaN positions skipped, NaN instanceColor, forceFallback, post-dispose inert.

### → Dashboard Bot
Wire rebuildPages (snippet in Still unwired P0).

### → Light / Motion
No new ask.

