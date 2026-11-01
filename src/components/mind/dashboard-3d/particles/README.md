# particles/ — Cosmos Motion Bot lane

Instanced cosmic dust and commit→comet trails. Fleet-owned.

## Scene integration

After the universe scene is built:

```ts
import { createDustField, createCommitComets } from "../particles";

const dust = createDustField(scene, { count: 480, seed: 42 });
const comets = createCommitComets(scene, status.commits, { max: 6 });

// in rAF:
dust.update(t, reducedMotion);
comets.update(t, reducedMotion);

// on teardown:
dust.dispose();
comets.dispose();
```

Feed real commits only. Respects prefers-reduced-motion (static dust, dimmed static comets).
