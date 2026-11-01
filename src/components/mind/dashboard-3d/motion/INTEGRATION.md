# Integration request (Cosmos Motion Bot → Dashboard Bot)

UniverseScene currently inlines pulse math and has no dust/comets.

Please wire (minimal):

```ts
import { sampleStarPulse, sampleOrbitDrift, pulsePhaseFromId } from "./motion";
import { createDustField, createCommitComets } from "./particles";

// once after scene create:
const dust = createDustField(scene, { count: 480 });
const comets = createCommitComets(scene, dataRef.current.commits, { max: 6 });

// replace inline pulse loop with:
const pulse = { scale: 1, glow: 2, emissive: 0.7 };
const drift = { x: 0, y: 0, z: 0 };
for (const n of botVis) {
  const phase = pulsePhaseFromId(n.id);
  sampleStarPulse(pulse, t, phase, n.health, reducedMotion);
  n.mesh.scale.setScalar(pulse.scale);
  n.glow.scale.setScalar(pulse.glow);
  sampleOrbitDrift(drift, n.base, t, phase, reducedMotion);
  n.mesh.position.set(drift.x, drift.y, drift.z);
  n.glow.position.copy(n.mesh.position);
}
dust.update(t, reducedMotion);
comets.update(t, reducedMotion);
```

Do not fabricate commits — pass `status.commits` only.
