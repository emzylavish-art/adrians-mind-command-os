import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectMinimap } from "./minimap.ts";

describe("minimap (#30 Gap#8)", () => {
  it("projects origin near center and clamps extremes", () => {
    const { points, home } = projectMinimap(
      [{ id: "a", pos: [0, 0, 0], health: "healthy" }, { id: "b", pos: [100, 0, -100] }],
      [0, 0, 0],
    );
    assert.ok(Math.abs(points[0]!.x - 0.5) < 0.01);
    assert.ok(points[1]!.x >= 0.02 && points[1]!.x <= 0.98);
    assert.ok(home.x > 0 && home.x < 1);
  });
});
