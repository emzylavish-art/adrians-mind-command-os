import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRig,
  dollyPose,
  easeInOutCubic,
  flyTo,
  focusBotTarget,
  stepRig,
  zoomOutTarget,
} from "./camera-rig.ts";

describe("camera-rig", () => {
  it("eases and completes a flyTo", () => {
    assert.equal(easeInOutCubic(0), 0);
    assert.equal(easeInOutCubic(1), 1);
    let rig = createRig();
    rig = flyTo(rig, focusBotTarget([2, 1, 0], "logic"), [0, 11, 18], [0, 0, 0]);
    assert.equal(rig.t, 0);
    assert.equal(rig.subjectId, "logic");
    const mid = stepRig(rig, 0.5, 1);
    assert.ok(mid.rig.t > 0 && mid.rig.t < 1);
    const end = stepRig(mid.rig, 2, 1);
    assert.equal(end.rig.t, 1);
    assert.deepEqual(end.lookAt, [2, 1, 0]);
  });

  it("dollies in/out with clamps", () => {
    const look: [number, number, number] = [0, 0, 0];
    const far = dollyPose([0, 0, 20], look, 800);
    assert.ok(Math.hypot(...far) < 20);
    const near = dollyPose([0, 0, 4], look, -2000);
    assert.ok(Math.hypot(...near) >= 3);
  });

  it("zoom-out steps interior->city->universe", () => {
    assert.equal(zoomOutTarget("interior").level, "city");
    assert.equal(zoomOutTarget("city").level, "universe");
    assert.equal(zoomOutTarget("universe").level, "universe");
  });
});
