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
// buildings: kit.createBuildingMaterial({ floors, progress })
// animate: tickPainterlyKit(kit, t)
// cleanup: detachCtx(); disposePainterlyKit(kit);
```

Replace inlined `PainterlyShader` / `makeStarSpriteTexture` / `makeNebulaTexture` / paint cards once imported.
