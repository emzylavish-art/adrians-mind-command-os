import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MINIMAP_MIN_SEP, hashUnit, projectMinimap, spanFromPositions } from "./minimap.ts";

describe("minimap (#30 Gap#8)", () => {
  it("projects origin near center and clamps extremes", () => {
    const { points, home } = projectMinimap(
      [{ id: "a", pos: [0, 0, 0], health: "healthy" }, { id: "b", pos: [100, 0, -100] }],
      [0, 0, 0],
    );
    assert.ok(Math.abs(points[0]!.x - 0.5) < 0.08);
    assert.ok(points[1]!.x >= 0.02 && points[1]!.x <= 0.98);
    assert.ok(home.x > 0 && home.x < 1);
  });
});

describe("minimap Gap#61 spread", () => {
  it("hashUnit is stable and in [0,1)", () => {
    assert.equal(hashUnit("grok-build"), hashUnit("grok-build"));
    assert.notEqual(hashUnit("a"), hashUnit("b"));
    assert.ok(hashUnit("x") >= 0 && hashUnit("x") < 1);
  });

  it("auto-span fits real positions tighter than a fixed 16", () => {
    const bots = [
      { id: "a", pos: [2, 0, 1] as [number, number, number], lane: "orchestrator" },
      { id: "b", pos: [-2, 0, -1] as [number, number, number], lane: "conductor" },
    ];
    const s = spanFromPositions(bots);
    assert.ok(s < 16);
    assert.ok(s >= 6);
  });

  it("clumped same-pos bots get deterministic separation", () => {
    const bots = [
      { id: "cosmos-painter", pos: [8.5, -2.2, -6.5] as [number, number, number], lane: "visual-fleet" },
      { id: "cosmos-light", pos: [8.5, -2.2, -6.5] as [number, number, number], lane: "visual-fleet" },
      { id: "cosmos-motion", pos: [8.5, -2.2, -6.5] as [number, number, number], lane: "visual-fleet" },
    ];
    const { points } = projectMinimap(bots, [0, 0, 0]);
    assert.equal(points.length, 3);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
        assert.ok(d + 1e-6 >= MINIMAP_MIN_SEP * 0.85, `pair ${i},${j} d=${d}`);
      }
    }
    // Stable across calls
    const again = projectMinimap(bots, [0, 0, 0]).points;
    assert.deepEqual(
      points.map((p) => [p.id, p.x, p.y]),
      again.map((p) => [p.id, p.x, p.y]),
    );
  });
});
