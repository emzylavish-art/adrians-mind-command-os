import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOTION_STATE_MAP_MAX, pruneMotionStateMap } from "./state-prune.ts";
import { createHealthPulseCrossfadeState } from "./health-pulse-crossfade.ts";

describe("c20 — pruneMotionStateMap", () => {
  it("drops ids that left status (Set / Map / array live ids)", () => {
    for (const live of [new Set(["a", "c"]), new Map([["a", 1], ["c", 1]]), ["a", null, "c"]]) {
      const m = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
      assert.equal(pruneMotionStateMap(m, live as never), 2);
      assert.deepEqual([...m.keys()], ["a", "c"]);
    }
  });

  it("null live ids (failed fetch) never wipes state; only the cap applies", () => {
    const m = new Map([["a", 1], ["b", 2]]);
    assert.equal(pruneMotionStateMap(m, null), 0);
    assert.equal(m.size, 2);
    assert.equal(pruneMotionStateMap(m, undefined, 1), 1);
    assert.deepEqual([...m.keys()], ["b"], "oldest evicted first");
  });

  it("empty live set (status says zero bots) clears", () => {
    const m = new Map([["a", 1]]);
    assert.equal(pruneMotionStateMap(m, new Set()), 1);
    assert.equal(m.size, 0);
  });

  it("id churn storm stays bounded by the cap", () => {
    const m = new Map<string, ReturnType<typeof createHealthPulseCrossfadeState>>();
    for (let i = 0; i < 20_000; i++) {
      m.set(`churn:${i}`, createHealthPulseCrossfadeState("healthy"));
      if (i % 100 === 0) pruneMotionStateMap(m, null);
    }
    pruneMotionStateMap(m, null);
    assert.ok(m.size <= MOTION_STATE_MAP_MAX, `size ${m.size}`);
  });

  it("onEvict sees every dropped entry; a throwing hook does not abort pruning", () => {
    const m = new Map([["a", 1], ["b", 2], ["c", 3]]);
    const seen: string[] = [];
    const n = pruneMotionStateMap(m, ["b"], 10, (id) => {
      seen.push(id);
      throw new Error("boom");
    });
    assert.equal(n, 2);
    assert.deepEqual(seen.sort(), ["a", "c"]);
    assert.deepEqual([...m.keys()], ["b"]);
  });

  it("garbage inputs are no-ops (null map, NaN / negative cap)", () => {
    assert.equal(pruneMotionStateMap(null, ["a"]), 0);
    const m = new Map([["a", 1]]);
    assert.equal(pruneMotionStateMap(m, ["a"], Number.NaN), 0);
    assert.equal(m.size, 1);
    assert.equal(pruneMotionStateMap(m, ["a"], -5), 1);
    assert.equal(m.size, 0);
  });
});
