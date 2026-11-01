# Painter → Dashboard Bot wiring

Lane isolation: Cosmos Painter Bot ships modules only under `shaders/` + `materials/`.

## Status vs origin/dashboard-3d (verified cycle 11)

| API | Status | Evidence |
|-----|--------|----------|
| `createPainterlyKit` + `painterlyPass` | **done** | `universe-scene` creates kit, `composer.addPass` |
| `createSkyMaterial` | **done** | sky mesh (may swap to Imagine backdrop) |
| `createBotStar` | **done** | `rebuildBots` |
| `createImagineNodeMaterial` / `setImagineNodeMap` | **done** | portraits, characters, scene arts |
| `createLorePlaqueMaterial` + text atlas | **done** | lock notes plaques |
| `createInkEdges` | **done** | `rebuildEdges` (Dashboard Bot wired) |
| `createLaneNebulae` | **done** | `rebuildNebulae` (Dashboard Bot wired) |
| `setPassHealth` / `resizePass` | **done** | frame loop + `onResize` |
| `createBuildingBrushMaterial` (+ c10 `uWindowGlow`) | **done** | `city-layer` rebuild with real `lit/floors` |
| `tickPainterlyKit(kit, t, { reducedMotion })` | **done** | frame loop passes `{ reducedMotion }` (still gated by `if (!reducedMotion)` so freeze path unused when reduced) |
| `setBuildingProgress` | **done** | `city-layer` calls after create with real lit/floors |
| `setBuildingWindowGlow` | optional | not required if progress drives glow |
| `attachPainterlyContextHandlers` | check scene | confirm detach on unmount |

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
// WIRED: tickPainterlyKit(kit, t, { reducedMotion }); setBuildingProgress(mat, progress)
// OPTIONAL: when reducedMotion, still call tick with { reducedMotion:true } instead of skipping block
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
