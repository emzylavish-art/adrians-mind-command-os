import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sampleOrbitDrift, type Xyz } from "./orbit-drift.ts";

describe("orbit-drift", () => {
  it("reducedMotion copies base", () => {
    const out: Xyz = { x: 0, y: 0, z: 0 };
    const base = { x: 3, y: 1, z: -2 };
    sampleOrbitDrift(out, base, 9, 1, true);
    assert.deepEqual(out, base);
  });

  it("drifts away from base over time then stays near", () => {
    const out: Xyz = { x: 0, y: 0, z: 0 };
    const base = { x: 4, y: 0, z: 0 };
    sampleOrbitDrift(out, base, 0, 0, false, { radius: 0.5, bobAmp: 0.1 });
    const first = { ...out };
    sampleOrbitDrift(out, base, 2.5, 0, false, { radius: 0.5, bobAmp: 0.1 });
    assert.notDeepEqual(out, first);
    const dist = Math.hypot(out.x - base.x, out.y - base.y, out.z - base.z);
    assert.ok(dist < 1.0);
  });
});
