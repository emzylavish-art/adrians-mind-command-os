import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMotionClock } from "./motion-clock.ts";
import { createFocusEaseState } from "./focus-ease.ts";
import {
  STAR_BATCH_MAX,
  createStarBatchScratch,
  disposeStarBatchScratch,
  stepStarFieldBatch,
} from "./star-batch.ts";
import type { PulseSample } from "./star-pulse.ts";
import type { Xyz } from "./orbit-drift.ts";

function makeBatch(n: number) {
  const ids = Array.from({ length: n }, (_, i) => `s${i}`);
  const healths = ids.map((_, i) => (i % 2 === 0 ? "healthy" : "idle"));
  const bases = ids.map((_, i) => ({ x: i, y: 0, z: -i }));
  const focus = ids.map(() => createFocusEaseState());
  const pulse: PulseSample[] = ids.map(() => ({ scale: 1, glow: 2, emissive: 0.5 }));
  const pos: Xyz[] = ids.map(() => ({ x: 0, y: 0, z: 0 }));
  return { ids, healths, bases, focus, pulse, pos };
}

describe("star-batch", () => {
  it("steps N stars into reusable outs; NaN count clamps", () => {
    const clock = createMotionClock();
    const n = 32;
    const b = makeBatch(n);
    const stepped = stepStarFieldBatch(
      b.ids, b.healths, b.bases, b.focus, b.pulse, b.pos,
      "s1", 1.5, 1 / 60, false, n, { clock },
    );
    assert.equal(stepped, n);
    assert.ok(b.focus[1]!.pulseMul > 1);
    assert.ok(Number.isFinite(b.pos[0]!.x));
    assert.equal(
      stepStarFieldBatch(b.ids, b.healths, b.bases, b.focus, b.pulse, b.pos, null, 1.5, 1 / 60, false, Number.NaN, { clock }),
      n,
    );
  });

  it("count 0 returns 0 and leaves outs untouched", () => {
    const clock = createMotionClock();
    const b = makeBatch(4);
    b.pos[0] = { x: 9, y: 9, z: 9 };
    const stepped = stepStarFieldBatch(
      b.ids, b.healths, b.bases, b.focus, b.pulse, b.pos,
      null, 1, 1 / 60, false, 0, { clock },
    );
    assert.equal(stepped, 0);
    assert.equal(b.pos[0]!.x, 9);
  });

  it("count 100k clamps to STAR_BATCH_MAX and array length", () => {
    const clock = createMotionClock();
    const b = makeBatch(16);
    const stepped = stepStarFieldBatch(
      b.ids, b.healths, b.bases, b.focus, b.pulse, b.pos,
      null, 1, 1 / 60, false, 100_000, { clock },
    );
    assert.equal(stepped, 16);
    assert.ok(STAR_BATCH_MAX >= 16);
    assert.ok(STAR_BATCH_MAX < 100_000);
    // Oversized parallel arrays still hard-capped
    const big = makeBatch(STAR_BATCH_MAX + 64);
    const capped = stepStarFieldBatch(
      big.ids, big.healths, big.bases, big.focus, big.pulse, big.pos,
      null, 1, 1 / 60, false, STAR_BATCH_MAX + 64, { clock },
    );
    assert.equal(capped, STAR_BATCH_MAX);
  });

  it("NaN base positions still yield finite pos/pulse outs", () => {
    const clock = createMotionClock();
    const b = makeBatch(3);
    b.bases[1] = { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: Number.NaN };
    const stepped = stepStarFieldBatch(
      b.ids, b.healths, b.bases, b.focus, b.pulse, b.pos,
      null, 2.5, 1 / 60, false, 3, { clock },
    );
    assert.equal(stepped, 3);
    for (const p of b.pos) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
    }
    for (const pul of b.pulse) {
      assert.ok(Number.isFinite(pul.scale) && Number.isFinite(pul.glow) && Number.isFinite(pul.emissive));
    }
  });

  it("ids removed / holes during iteration are skipped without throw", () => {
    const clock = createMotionClock();
    const b = makeBatch(5);
    // Simulate mid-frame removal: sparse hole + length shrink via Proxy
    const ids = [...b.ids] as (string | undefined)[];
    ids[2] = undefined;
    let accesses = 0;
    const proxiedIds = new Proxy(ids, {
      get(target, prop, recv) {
        if (prop === "length") return target.length;
        const idx = typeof prop === "string" && /^\d+$/.test(prop) ? Number(prop) : NaN;
        if (Number.isInteger(idx)) {
          accesses++;
          // After first couple reads, "remove" trailing ids (batch shrink mid-frame)
          if (accesses === 3 && target.length > 3) target.length = 3;
          return target[idx as number];
        }
        return Reflect.get(target, prop, recv);
      },
    });
    const stepped = stepStarFieldBatch(
      proxiedIds as string[],
      b.healths,
      b.bases,
      b.focus,
      b.pulse,
      b.pos,
      null,
      1,
      1 / 60,
      false,
      5,
      { clock },
    );
    // Snapshot n at start against original lengths (5) but holes skipped → stepped < 5
    assert.ok(stepped >= 0 && stepped <= 5);
    assert.ok(Number.isFinite(b.pos[0]!.x));
  });

  it("scratch buffers reusable after dispose (typed-array path)", () => {
    const clock = createMotionClock();
    const scratch = createStarBatchScratch(8);
    assert.equal(scratch.capacity, 8);
    assert.equal(scratch.disposed, false);
    // Pack bases into Float32Array
    for (let i = 0; i < 4; i++) {
      scratch.baseXYZ[i * 3] = i;
      scratch.baseXYZ[i * 3 + 1] = 1;
      scratch.baseXYZ[i * 3 + 2] = -i;
      scratch.ids[i] = `t${i}`;
      scratch.healths[i] = i % 2 === 0 ? "healthy" : "blocked";
    }
    const n1 = stepStarFieldBatch(
      scratch.ids,
      scratch.healths,
      scratch.bases,
      scratch.focus,
      scratch.pulse,
      scratch.pos,
      null,
      1,
      1 / 60,
      false,
      4,
      { clock },
    );
    assert.equal(n1, 4);
    disposeStarBatchScratch(scratch);
    assert.equal(scratch.disposed, true);
    // Reuse after dispose must not throw; either no-op or re-arm via create path
    const reused = createStarBatchScratch(8, scratch);
    assert.equal(reused.disposed, false);
    reused.ids[0] = "again";
    reused.healths[0] = "healthy";
    reused.baseXYZ[0] = 1;
    reused.baseXYZ[1] = 2;
    reused.baseXYZ[2] = 3;
    const n2 = stepStarFieldBatch(
      reused.ids,
      reused.healths,
      reused.bases,
      reused.focus,
      reused.pulse,
      reused.pos,
      null,
      2,
      1 / 60,
      false,
      1,
      { clock },
    );
    assert.equal(n2, 1);
    assert.ok(Number.isFinite(reused.pos[0]!.x));
  });

  it("batch resize mid-frame (shrinking count between calls) stays finite", () => {
    const clock = createMotionClock();
    const b = makeBatch(64);
    let n = stepStarFieldBatch(
      b.ids, b.healths, b.bases, b.focus, b.pulse, b.pos,
      "s3", 1, 1 / 60, false, 64, { clock },
    );
    assert.equal(n, 64);
    // Shrink working set without realloc
    n = stepStarFieldBatch(
      b.ids, b.healths, b.bases, b.focus, b.pulse, b.pos,
      "s3", 1.1, 1 / 60, false, 7, { clock },
    );
    assert.equal(n, 7);
    for (let i = 0; i < 7; i++) {
      assert.ok(Number.isFinite(b.pos[i]!.x));
    }
  });
});
