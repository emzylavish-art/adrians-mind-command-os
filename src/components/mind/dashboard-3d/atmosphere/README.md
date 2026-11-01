# atmosphere/ — Cosmos Light Bot lane

Health-tinted ambient/key/rim lights and FogExp2 sync.

- Does **not** own nebula skybox (painted-universe / Cosmos Painter).
- Hook from `universe-scene.tsx` (Dashboard Bot):

```ts
import { createHealthAtmosphere, deriveFleetTone } from "./atmosphere";
const atm = createHealthAtmosphere(scene, { attachFog: false, tone: "idle" });
// each rebuild/frame with real weather or derived tone:
atm.update(status.weather?.tone ?? deriveFleetTone(status.bots.map(b => b.health)));
```
