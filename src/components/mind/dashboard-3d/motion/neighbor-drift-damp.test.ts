import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFocusEaseState } from "./focus-ease.ts";
import {
  NEIGHBOR_DRIFT_FLOOR,
  collectOneHopNeighbors,
  neighborDriftTarget,
  stepNeighborDriftDamp,
  stepNeighborDriftDampBatch,
} from "./neighbor-drift-damp.ts";

describe("neighbor-drift-damp", () => {
  it("collects 1-hop neighbors and ignores self-loops/nulls", () => {
    const edges: Array<[string | null, string | null]> = [
      ["a", "b"],
      ["b", "c"],
      ["a", "a"],
      [null, "a"],
      ["a", "d"],
    ];
    const n = collectOneHopNeighbors(edges, "a");
    assert.equal(n.has("b"), true);
    assert.equal(n.has("d"), true);
    assert.equal(n.has("c"), false);
    assert.equal(n.has("a"), false);
    assert.equal(collectOneHopNeighbors(edges, null).size, 0);
  });

  it("eases neighbor driftMul toward floor; RM skips extra damp", () => {
    const neighbors = new Set(["b", "c"]);
    const st = createFocusEaseState();
    assert.equal(neighborDriftTarget("b", "a", neighbors), NEIGHBOR_DRIFT_FLOOR);
    assert.equal(neighborDriftTarget("a", "a", neighbors), 0);
    assert.equal(neighborDriftTarget("z", "a", neighbors), 1);

    for (let i = 0; i < 90; i++) {
      stepNeighborDriftDamp(st, "b", "a", neighbors, 1 / 60, false);
    }
    assert.ok(st.driftMul < 0.5 && st.driftMul >= NEIGHBOR_DRIFT_FLOOR - 0.05);

    const stRm = createFocusEaseState();
    stRm.driftMul = 0.5;
    stepNeighborDriftDamp(stRm, "b", "a", neighbors, 1 / 60, true);
    assert.equal(stRm.driftMul, 1);
  });

  it("batch does not fight focus pinning; clears when focus leaves", () => {
    const ids = ["a", "b", "c"];
    const focus = ids.map(() => createFocusEaseState());
    const neighbors = new Set(["b"]);
    // Simulate focus-ease pinning on a
    focus[0]!.driftMul = 0;
    focus[0]!.pulseMul = 1.25;
    for (let i = 0; i < 60; i++) {
      stepNeighborDriftDampBatch(ids, focus, "a", neighbors, 1 / 60, false);
    }
    assert.equal(focus[0]!.driftMul, 0); // untouched focused
    assert.ok(focus[1]!.driftMul < 0.6);
    assert.ok(focus[2]!.driftMul > 0.9); // non-neighbor stays near 1

    // Focus cleared → neighbors recover toward 1
    for (let i = 0; i < 90; i++) {
      stepNeighborDriftDampBatch(ids, focus, null, new Set(), 1 / 60, false);
    }
    assert.ok(focus[1]!.driftMul > 0.9);
  });
});
