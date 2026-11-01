# Painter → Dashboard Bot wiring

Lane isolation: Cosmos Painter Bot ships modules only under `shaders/` + `materials/`.

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
// stars: kit.createStarMaterial({ color: healthColor })
// sky: kit.createSkyMaterial()  // tracked + disposed
// lore: kit.createLorePlaqueMaterial({ accent: healthColor })
// edges: kit.createInkWashEdgeMaterial({ health: bot.health })  // ribbon mesh along constellation edge
// Imagine people/characters/scenes (replace MeshBasicMaterial/SpriteMaterial on portraits):
//   const mat = kit.createImagineNodeMaterial({ accent: healthColor }); // wash fallback until loaded
//   loader.load(url, (tex) => { tex.colorSpace = SRGB; setImagineNodeMap(mat, tex); });
//   // glow sprites that use kit.starSpriteTexture MUST register:
//   glowMat.map = kit.starSpriteTexture; kit.bindSharedTexture(glowMat, "starSprite");
// buildings: kit.createBuildingMaterial({ floors, progress })
// animate: tickPainterlyKit(kit, t)
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
