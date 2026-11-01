/**
 * c19 ship — star-batch opt-in health crossfade + neighbor drift damp.
 * Omitting the opts keeps c16 output identical; with them Dashboard gets
 * c17 crossfade + c18/c19 neighbor damp in the single universe-tick call.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { createMotionClock } from "./motion-clock.ts";
import { createFocusEaseState } from "./focus-ease.ts";
import { createHealthPulseCrossfadeState } from "./health-pulse-crossfade.ts";
import { NEIGHBOR_DRIFT_FLOOR } from "./neighbor-drift-damp.ts";
import { STAR_BATCH_ORBIT_OPTS, stepStarFieldBatch } from "./star-batch.ts";
import type { PulseSample } from "./star-pulse.ts";
import type { Xyz } from "./orbit-drift.ts";

const DT = 1 / 60;

function rig(n: number) {
  const ids = Array.from({ length: n }, (_, i) => `bot:${i}`);
  const healths: string[] = ids.map(() => "healthy");
  const bases: Xyz[] = ids.map((_, i) => ({ x: i, y: 0, z: -i }));
  const focus = ids.map(() => createFocusEaseState());
  const pulse: PulseSample[] = ids.map(() => ({ scale: 1, glow: 2, emissive: 0.5 }));
  const pos: Xyz[] = ids.map(() => ({ x: 0, y: 0, z: 0 }));
  const xfade = ids.map(() => createHealthPulseCrossfadeState("healthy"));
  return { ids, healths, bases, focus, pulse, pos, xfade };
}

describe("c19 — star-batch xfade + neighbors (opt-in)", () => {
  it("no opts → identical to c16 path; empty xfade/neighbors also identical", () => {
    const clock = createMotionClock();
    const a = rig(8);
    const b = rig(8);
    for (let f = 0; f < 120; f++) {
      const t = f * DT;
      stepStarFieldBatch(a.ids, a.healths, a.bases, a.focus, a.pulse, a.pos, "bot:2", t, DT, false, 8, { clock });
      stepStarFieldBatch(b.ids, b.healths, b.bases, b.focus, b.pulse, b.pos, "bot:2", t, DT, false, 8, {
        clock,
        xfade: null,
        neighbors: null,
      });
    }
    assert.deepEqual(a.pulse, b.pulse);
    assert.deepEqual(a.pos.map((p) => [p.x, p.y, p.z]), b.pos.map((p) => [p.x, p.y, p.z]));
  });

  it("health flip eases with xfade (smaller jump than the snapping path)", () => {
    const clock = createMotionClock();
    const snap = rig(1);
    const ease = rig(1);
    let t = 1;
    for (let f = 0; f < 60; f++, t += DT) {
      stepStarFieldBatch(snap.ids, snap.healths, snap.bases, snap.focus, snap.pulse, snap.pos, null, t, DT, false, 1, { clock });
      stepStarFieldBatch(ease.ids, ease.healths, ease.bases, ease.focus, ease.pulse, ease.pos, null, t, DT, false, 1, { clock, xfade: ease.xfade });
    }
    const s0 = snap.pulse[0]!.glow;
    const e0 = ease.pulse[0]!.glow;
    snap.healths[0] = "idle";
    ease.healths[0] = "idle";
    stepStarFieldBatch(snap.ids, snap.healths, snap.bases, snap.focus, snap.pulse, snap.pos, null, t, DT, false, 1, { clock });
    stepStarFieldBatch(ease.ids, ease.healths, ease.bases, ease.focus, ease.pulse, ease.pos, null, t, DT, false, 1, { clock, xfade: ease.xfade });
    const jSnap = Math.abs(snap.pulse[0]!.glow - s0);
    const jEase = Math.abs(ease.pulse[0]!.glow - e0);
    assert.ok(jEase < jSnap * 0.5 || jSnap < 1e-3, `ease ${jEase} vs snap ${jSnap}`);
    assert.equal(ease.xfade[0]!.to, "idle");
    for (let f = 0; f < 240; f++, t += DT) {
      stepStarFieldBatch(ease.ids, ease.healths, ease.bases, ease.focus, ease.pulse, ease.pos, null, t, DT, false, 1, { clock, xfade: ease.xfade });
    }
    assert.equal(ease.xfade[0]!.blend, 1);
  });

  it("reduced-motion: xfade snaps; neighbors stay at full drift", () => {
    const clock = createMotionClock();
    const r = rig(3);
    r.healths[1] = "blocked";
    stepStarFieldBatch(r.ids, r.healths, r.bases, r.focus, r.pulse, r.pos, "bot:0", 1, DT, true, 3, {
      clock,
      xfade: r.xfade,
      neighbors: new Set(["bot:1"]),
    });
    assert.equal(r.xfade[1]!.to, "blocked");
    assert.equal(r.xfade[1]!.blend, 1);
    assert.equal(r.focus[1]!.driftMul, 1);
  });

  it("neighbors settle at the floor; others at 1; focus pinned", () => {
    const clock = createMotionClock();
    const r = rig(4);
    const nb = new Set(["bot:1"]);
    for (let f = 0; f < 600; f++) {
      stepStarFieldBatch(r.ids, r.healths, r.bases, r.focus, r.pulse, r.pos, "bot:0", f * DT, DT, false, 4, { clock, neighbors: nb });
    }
    assert.ok(r.focus[0]!.driftMul < 1e-3);
    assert.ok(Math.abs(r.focus[1]!.driftMul - NEIGHBOR_DRIFT_FLOOR) < 1e-3, `nb ${r.focus[1]!.driftMul}`);
    assert.ok(r.focus[2]!.driftMul > 0.999);
  });

  it("short / holey xfade array is tolerated (no throw, finite)", () => {
    const clock = createMotionClock();
    const r = rig(5);
    const holey = [r.xfade[0], null, undefined] as const;
    for (let f = 0; f < 30; f++) {
      stepStarFieldBatch(r.ids, r.healths, r.bases, r.focus, r.pulse, r.pos, null, f * DT, DT, false, 5, { clock, xfade: holey });
    }
    for (const p of r.pulse) assert.ok(Number.isFinite(p.scale) && Number.isFinite(p.glow));
  });

  it("caller clock is not pinned in module scope after the batch", () => {
    const clock = createMotionClock();
    const r = rig(2);
    stepStarFieldBatch(r.ids, r.healths, r.bases, r.focus, r.pulse, r.pos, null, 1, DT, false, 2, { clock });
    assert.equal(STAR_BATCH_ORBIT_OPTS.clock, undefined);
  });

  it("500 stars with xfade+neighbors flapping: steady-state heap < 128 B/frame", () => {
    let g = (globalThis as { gc?: () => void }).gc;
    if (typeof g !== "function") {
      setFlagsFromString("--expose-gc");
      g = runInNewContext("gc") as () => void;
    }
    const clock = createMotionClock();
    const N = 500;
    const r = rig(N);
    const nb = new Set(r.ids.slice(1, 40));
    const opts = { clock, xfade: r.xfade, neighbors: nb };
    const hs = ["healthy", "blocked", "stalled", "idle"];
    const run = (frames: number, off: number) => {
      for (let f = 0; f < frames; f++) {
        if (f % 7 === 0) for (let i = 0; i < N; i += 13) r.healths[i] = hs[(f + i) % 4]!;
        stepStarFieldBatch(r.ids, r.healths, r.bases, r.focus, r.pulse, r.pos, "bot:0", (off + f) * DT, DT, false, N, opts);
      }
    };
    run(600, 0);
    g!();
    g!();
    const before = process.memoryUsage().heapUsed;
    const FR = 2000;
    run(FR, 600);
    g!();
    g!();
    const perFrame = (process.memoryUsage().heapUsed - before) / FR;
    assert.ok(perFrame < 128, `heap growth ${perFrame.toFixed(1)} B/frame`);
  });
});
