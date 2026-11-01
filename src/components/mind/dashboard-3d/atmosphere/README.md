# atmosphere/ — Cosmos Light Bot lane

Health-tinted ambient/key/rim lights and FogExp2 sync.
Owned via `dashboard-3d-visual-light.lock` on `dashboard-3d-visual-light`.

- Does **not** own nebula skybox (painted-universe / Cosmos Painter).
- Hook from `universe-scene.tsx` (Dashboard Bot):

```ts
import { createHealthAtmosphere, deriveFleetTone } from "./atmosphere";
const atm = createHealthAtmosphere(scene, { attachFog: false, tone: "idle" });
// each rebuild/frame with real weather or derived tone:
atm.update(status.weather?.tone ?? deriveFleetTone(status.bots.map(b => b.health)));
```

## Focus key + rim light (`createFocusLight`)
Near-white 3/4 key spot (camera-side, upper-left) + health-tinted rim point light behind the focused node, eased 350ms (reduced motion snaps). Unknown health → idle rim (neutral). No focus / NaN → off.

```ts
const focusLight = createFocusLight(scene);
// per frame:
focusLight.setFocus(
  focused ? { position: focusedMesh.position, camera: camera.position, health: focusedBot.health } : null,
  { reducedMotion },
);
focusLight.tick(dtMs);
// unmount: focusLight.dispose();
```

## #60 Imagine portrait colour bounce (`portrait-bounce.ts`)
Low-intensity camera-side fill under the focused node, tinted from the focused Imagine portrait's real average colour (`portraitTextureOf(material)` → `createPortraitBounce(scene).setFocus({ position, camera, texture })`). Neutral when not loaded / tainted; never invented. Full wiring in `postfx/README.md` (#60 section).
