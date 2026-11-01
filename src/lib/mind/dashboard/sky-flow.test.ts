import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lineDashOffset,
  lineFlowPhase,
  samplePolylineTravel,
  travelProgress,
} from "./sky-flow.ts";

describe("sky-flow", () => {
  it("lineFlowPhase is finite and wraps into [0,1)", () => {
    for (const t of [0, 0.5, 10, 1e6, Number.NaN, -3]) {
      const p = lineFlowPhase(t, 0.35, 1.2);
      assert.ok(Number.isFinite(p));
      assert.ok(p >= 0 && p < 1);
    }
  });

  it("lineDashOffset is finite and moves with time", () => {
    const a = lineDashOffset(0, 0.55, 0);
    const b = lineDashOffset(2, 0.55, 0);
    assert.ok(Number.isFinite(a) && Number.isFinite(b));
    assert.ok(b < a);
    assert.ok(Number.isFinite(lineDashOffset(Number.NaN)));
  });

  it("samplePolylineTravel lerps and survives garbage", () => {
    const out = { x: 0, y: 0, z: 0 };
    samplePolylineTravel(out, [], 0.5);
    assert.deepEqual(out, { x: 0, y: 0, z: 0 });
    samplePolylineTravel(out, [{ x: 1, y: 2, z: 3 }], 0.9);
    assert.deepEqual(out, { x: 1, y: 2, z: 3 });
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
    ];
    samplePolylineTravel(out, pts, 0.25);
    assert.ok(Math.abs(out.x - 5) < 1e-9 && out.y === 0);
    samplePolylineTravel(out, pts, 0.75);
    assert.ok(Math.abs(out.x - 10) < 1e-9 && Math.abs(out.y - 5) < 1e-9);
    samplePolylineTravel(out, [{ x: Number.NaN, y: 1, z: 2 }, { x: 4, y: Number.NaN, z: 6 }], 1);
    assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z));
  });

  it("travelProgress loops", () => {
    assert.ok(travelProgress(0, 6) >= 0 && travelProgress(0, 6) < 1);
    assert.ok(Math.abs(travelProgress(6, 6) - travelProgress(0, 6)) < 1e-9 || travelProgress(6, 6) === 0);
    assert.ok(Number.isFinite(travelProgress(Number.NaN, 0)));
  });
});
