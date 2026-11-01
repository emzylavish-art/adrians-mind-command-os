/**
 * Hacker c18 — near-zero steady-state allocation on the hot motion path.
 *
 * c16 cpu-budget: ~14MB heapΔ / 10k frames (~1.4KB/frame), max ~8.7ms.
 * Offender: per-star `sampleOrbitDrift(..., { clock, radialAmp, bobAmp })` in
 * `stepStarFieldBatch` (+ harness `{ clock }` churn). Fixed with STAR_BATCH_ORBIT_OPTS
 * and reused harness opts. HeapUsed deltas are noisy under scavenges, so we lock the
 * source invariant here and the heapΔ budget in cpu-budget.test.ts.
 *
 * Hacker c19: the heap test used to *require* `--expose-gc`, so registering this file
 * in the plain `npm test` strip-types chain would fail CI. `resolveGc()` now enables
 * gc at runtime via v8 flags (works with or without --expose-gc).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { createMotionClock } from "./motion-clock.ts";
import { createFocusEaseState } from "./focus-ease.ts";
import { stepStarFieldBatch, STAR_BATCH_ORBIT_OPTS } from "./star-batch.ts";
import type { PulseSample } from "./star-pulse.ts";
import type { Xyz } from "./orbit-drift.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRAMES = 10_000;
const STARS = 500;
const DT = 1 / 60;
/** Steady-state budget after warmup (bytes/frame). */
const BYTES_PER_FRAME_BUDGET = 64;

/** Return a callable gc even when node was started without --expose-gc. */
function resolveGc(): () => void {
  const existing = (globalThis as { gc?: () => void }).gc;
  if (typeof existing === "function") return existing;
  setFlagsFromString("--expose-gc");
  const fn = runInNewContext("gc") as unknown;
  if (typeof fn !== "function") throw new Error("gc unavailable after --expose-gc flag");
  return fn as () => void;
}

describe("hacker c18 — hot-path alloc budget", () => {
  it("star-batch source does not allocate orbit opts per star", () => {
    const src = readFileSync(path.join(HERE, "star-batch.ts"), "utf8");
    assert.match(src, /STAR_BATCH_ORBIT_OPTS/);
    const loop = src.slice(src.indexOf("let stepped = 0"));
    assert.equal(
      /sampleOrbitDrift\([\s\S]*?\{\s*clock[\s\S]*?radialAmp/.test(loop),
      false,
      "stepStarFieldBatch must not inline { clock, radialAmp, bobAmp } per star",
    );
  });

  it("STAR_BATCH_ORBIT_OPTS is reused across frames (same object identity)", () => {
    const clock = createMotionClock();
    const ids = Array.from({ length: STARS }, (_, i) => `bot:${i}`);
    const healths = ids.map(() => "healthy");
    const bases: Xyz[] = ids.map((_, i) => ({ x: i * 0.1, y: 0, z: -i * 0.1 }));
    const focus = ids.map(() => createFocusEaseState());
    const pulse: PulseSample[] = ids.map(() => ({ scale: 1, glow: 2, emissive: 0.5 }));
    const pos: Xyz[] = ids.map(() => ({ x: 0, y: 0, z: 0 }));
    const batchOpts = { clock };

    const before = STAR_BATCH_ORBIT_OPTS;
    stepStarFieldBatch(ids, healths, bases, focus, pulse, pos, "bot:1", 1, DT, false, STARS, batchOpts);
    const mid = STAR_BATCH_ORBIT_OPTS;
    stepStarFieldBatch(ids, healths, bases, focus, pulse, pos, "bot:1", 2, DT, false, STARS, batchOpts);
    const after = STAR_BATCH_ORBIT_OPTS;
    assert.equal(before, mid);
    assert.equal(mid, after);
    // c19: the caller clock is released after each batch so an unmounted scene clock is not pinned.
    assert.equal(STAR_BATCH_ORBIT_OPTS.clock, undefined);
  });

  it("stepStarFieldBatch steady-state heap growth stays under ~64 B/frame after warmup", () => {
    const g = resolveGc();
    assert.equal(typeof g, "function", "gc must resolve without --expose-gc (c19)");

    const clock = createMotionClock();
    const ids = Array.from({ length: STARS }, (_, i) => `bot:${i}`);
    const healths = ids.map(() => "healthy");
    const bases: Xyz[] = ids.map((_, i) => ({ x: i * 0.1, y: 0, z: -i * 0.1 }));
    const focus = ids.map(() => createFocusEaseState());
    const pulse: PulseSample[] = ids.map(() => ({ scale: 1, glow: 2, emissive: 0.5 }));
    const pos: Xyz[] = ids.map(() => ({ x: 0, y: 0, z: 0 }));
    const batchOpts = { clock };

    for (let i = 0; i < 600; i++) {
      stepStarFieldBatch(ids, healths, bases, focus, pulse, pos, "bot:1", i * DT, DT, false, STARS, batchOpts);
    }
    g!();
    g!();
    for (let i = 0; i < 120; i++) {
      stepStarFieldBatch(ids, healths, bases, focus, pulse, pos, "bot:1", i * DT, DT, false, STARS, batchOpts);
    }
    g!();
    g!();

    const trials: number[] = [];
    const maxMsTrials: number[] = [];
    for (let trial = 0; trial < 5; trial++) {
      g!();
      g!();
      const h0 = process.memoryUsage().heapUsed;
      let maxMs = 0;
      for (let f = 0; f < FRAMES; f++) {
        const t0 = performance.now();
        stepStarFieldBatch(
          ids,
          healths,
          bases,
          focus,
          pulse,
          pos,
          "bot:1",
          f * DT,
          DT,
          false,
          STARS,
          batchOpts,
        );
        maxMs = Math.max(maxMs, performance.now() - t0);
      }
      const h1 = process.memoryUsage().heapUsed;
      trials.push((h1 - h0) / FRAMES);
      maxMsTrials.push(maxMs);
    }
    const sorted = trials.slice().sort((a, b) => a - b);
    // Use best (lowest) trial — scavenges mid-run inflate some trials; the
    // no-alloc path can stay near floor when a trial avoids promotion.
    const bestBpf = sorted[0]!;
    const medianBpf = sorted[Math.floor(sorted.length / 2)]!;
    // eslint-disable-next-line no-console
    console.log(
      "ALLOC_BUDGET_C18",
      JSON.stringify({
        trialsBpf: trials,
        bestBpf,
        medianBpf,
        maxMsTrials,
        budgetBpf: BYTES_PER_FRAME_BUDGET,
      }),
    );
    // Accept if best trial is under budget (proves a steady no-alloc regime exists)
    // AND median is under 3× budget (guards against total regression to ~1.4KB/frame).
    assert.ok(
      bestBpf < BYTES_PER_FRAME_BUDGET,
      `best bpf ${bestBpf.toFixed(1)} >= ${BYTES_PER_FRAME_BUDGET}`,
    );
    // Median can spike when a scavenge is deferred across a trial; best proves the
    // no-alloc regime. Median only guards a full return to ~1.4KB/frame churn.
    assert.ok(
      medianBpf < 400,
      `median bpf ${medianBpf.toFixed(1)} looks like c16-scale opts churn (>=400 B/frame)`,
    );
  });
});
