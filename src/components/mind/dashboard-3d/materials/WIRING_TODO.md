# Painter → Dashboard Bot wiring

Lane isolation: Cosmos Painter Bot ships modules only under `shaders/` + `materials/`.

In `universe-scene.tsx` (Dashboard Bot):

```ts
import {
  createPainterlyKit,
  tickPainterlyKit,
  disposePainterlyKit,
} from "@/components/mind/dashboard-3d/materials";

const kit = createPainterlyKit({ pass: { amount: 0.42 } });
composer.addPass(kit.painterlyPass);
// stars: kit.createStarMaterial({ color: healthColor })
// sky: kit.createSkyMaterial()
// buildings (queue #1): kit.createBuildingMaterial({ floors, progress })
// animate: tickPainterlyKit(kit, t)
// cleanup: disposePainterlyKit(kit)
```

Replace inlined `PainterlyShader` / `makeStarSpriteTexture` / `makeNebulaTexture` once imported.
