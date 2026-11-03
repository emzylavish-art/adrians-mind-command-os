import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMotionClock } from "./motion-clock.ts";

describe("motion clock (hacker pass c4)", () => {
  it("two time bases in one frame (now*0.001 + elapsed) do not double motion speed", () => {
    const k = createMotionClock();
    let a = 1000;
    let b = 5;
    const a0 = k.map(a);
    k.map(b);
    for (let i = 0; i < 60; i++) {
      a += 1 / 60;
      b += 1 / 60;
      k.map(a);
      k.map(a); // second sampler, same frame
      k.map(b);
    }
    const advanced = k.map(a) - a0;
    assert.ok(Math.abs(advanced - 1) < 0.05, `source A advanced ${advanced.toFixed(3)}s over 1s of frames`);
  });

  it("sustained slow frames (3 fps) keep moving instead of freezing at 1/60 per frame", () => {
    const k = createMotionClock();
    let w = 10;
    const t0 = k.map(w);
    for (let i = 0; i < 30; i++) k.map((w += 1 / 3));
    const advanced = k.map(w) - t0;
    assert.ok(advanced >= 7, `3fps for 10s advanced only ${advanced.toFixed(3)}s`);
    assert.ok(advanced <= 10 + 1e-9);
  });

  it("a real hidden-tab gap still collapses to one frame", () => {
    const k = createMotionClock();
    const t0 = k.map(10);
    const t1 = k.map(10 + 1 / 60);
    const t2 = k.map(310);
    assert.ok(t2 - t1 <= 0.05, `resume step ${(t2 - t1).toFixed(3)}`);
    assert.ok(t1 > t0);
  });

  it("anchor table is bounded under a flood of distinct sources", () => {
    const k = createMotionClock();
    for (let i = 0; i < 10_000; i++) k.map(i * 1000 + Math.random());
    assert.ok(Number.isFinite(k.time));
    assert.ok(k.anchorCount <= 4);
  });
});
