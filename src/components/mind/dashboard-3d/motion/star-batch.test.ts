import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMotionClock } from "./motion-clock.ts";
import { createFocusEaseState } from "./focus-ease.ts";
import { stepStarFieldBatch } from "./star-batch.ts";
import type { PulseSample } from "./star-pulse.ts";
import type { Xyz } from "./orbit-drift.ts";

describe("star-batch", () => {
  it("steps N stars into reusable outs; NaN count clamps", () => {
    const clock = createMotionClock();
    const n = 32;
    const ids = Array.from({ length: n }, (_, i) => `s${i}`);
    const healths = ids.map((_, i) => (i % 2 === 0 ? "healthy" : "idle"));
    const bases = ids.map((_, i) => ({ x: i, y: 0, z: -i }));
    const focus = ids.map(() => createFocusEaseState());
    const pulse: PulseSample[] = ids.map(() => ({ scale: 1, glow: 2, emissive: 0.5 }));
    const pos: Xyz[] = ids.map(() => ({ x: 0, y: 0, z: 0 }));
    const stepped = stepStarFieldBatch(
      ids, healths, bases, focus, pulse, pos,
      "s1", 1.5, 1 / 60, false, n, { clock },
    );
    assert.equal(stepped, n);
    assert.ok(focus[1]!.pulseMul > 1);
    assert.ok(Number.isFinite(pos[0]!.x));
    assert.equal(
      stepStarFieldBatch(ids, healths, bases, focus, pulse, pos, null, 1.5, 1 / 60, false, Number.NaN, { clock }),
      n,
    );
  });
});
