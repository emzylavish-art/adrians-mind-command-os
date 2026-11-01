# postfx/ — Cosmos Light Bot lane

EffectComposer helpers: health-aware UnrealBloomPass tuning + color-grade ShaderPass.

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
