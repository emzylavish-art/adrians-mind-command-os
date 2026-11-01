# Painter → Dashboard Bot wiring

Lane isolation: Cosmos Painter Bot ships modules only under `shaders/` + `materials/`.

```ts
import {
  createPainterlyKit,
  tickPainterlyKit,
  disposePainterlyKit,
  attachPainterlyContextHandlers,
} from "@/components/mind/dashboard-3d/materials";

const kit = createPainterlyKit({ pass: { amount: 0.42 } });
composer.addPass(kit.painterlyPass);
const detachCtx = attachPainterlyContextHandlers(renderer.domElement, kit);
// stars: kit.createStarMaterial({ color: healthColor })
// sky: kit.createSkyMaterial()  // tracked + disposed
// lore: kit.createLorePlaqueMaterial({ accent: healthColor })
// edges: kit.createInkWashEdgeMaterial({ health: bot.health })  // ribbon mesh along constellation edge
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
- `tickPainterlyKit(kit, t)` already ticks `InkWashEdgeMaterial`; shader time is wrapped to `PAINTER_TIME_PERIOD` (600s) so long-running wall sessions don't overflow mediump.
- Optional: `getMaxTextureSize` → `createPaperGrainTexture({ maxTextureSize: renderer.capabilities.maxTextureSize })`.

## Next painter candidate
- Context-restore rebinding: after `webglcontextrestored`, the kit recreates `paperGrainTexture`/`starSpriteTexture`, but materials that captured the old texture objects (e.g. star `map`) still reference disposed ones; add a rebind pass over `kit.tracked`.
- Lore plaque text atlas (queue tail).
