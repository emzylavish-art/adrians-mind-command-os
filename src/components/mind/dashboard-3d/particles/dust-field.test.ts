import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { seedDustParticles } from "./dust-field.ts";

describe("dust-field seeds", () => {
  it("is deterministic for a seed", () => {
    const a = seedDustParticles(20, 10, 8, 42);
    const b = seedDustParticles(20, 10, 8, 42);
    assert.equal(a.length, 20);
    assert.deepEqual(a, b);
  });

  it("different seeds diverge", () => {
    const a = seedDustParticles(10, 10, 8, 1);
    const b = seedDustParticles(10, 10, 8, 2);
    assert.notDeepEqual(a[0], b[0]);
  });

  it("keeps particles inside radius envelope", () => {
    const parts = seedDustParticles(100, 12, 6, 7);
    for (const p of parts) {
      assert.ok(Math.hypot(p.x, p.z) <= 12 + 1e-6);
      assert.ok(Math.abs(p.y) <= 3 + 1e-6);
    }
  });
});
