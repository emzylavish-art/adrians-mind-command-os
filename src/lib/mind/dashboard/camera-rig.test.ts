import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptFlyDispatch,
  acceptPointerPick,
  createRig,
  dollyPose,
  easeInOutCubic,
  flyTo,
  focusBotTarget,
  isGliding,
  stepRig,
  stepRigSmooth,
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

describe("camera-rig glide guards (hacker pass click-spam)", () => {
  it("rejects pointer picks while gliding and accepts after settle", () => {
    let rig = createRig();
    rig = flyTo(rig, focusBotTarget([1, 0, 0], "logic"), [0, 11, 18], [0, 0, 0]);
    assert.equal(acceptPointerPick(rig), false);
    assert.equal(isGliding(rig), true);
    // SKY / ZOOM_OUT remain dispatchable mid-glide so the user can escape
    assert.equal(acceptFlyDispatch(rig, "SKY"), true);
    assert.equal(acceptFlyDispatch(rig, "ZOOM_OUT"), true);
    assert.equal(acceptFlyDispatch(rig, "DIVE"), false);
    assert.equal(acceptFlyDispatch(rig, "ENTER"), false);
    let end = { rig, position: [0, 0, 0] as [number, number, number], lookAt: [0, 0, 0] as [number, number, number] };
    for (let i = 0; i < 20; i++) end = stepRigSmooth(end.rig, 0.2, 1);
    assert.equal(end.rig.t, 1);
    assert.equal(acceptPointerPick(end.rig), true);
    assert.equal(acceptFlyDispatch(end.rig, "DIVE"), true);
  });

  it("stepRigSmooth survives NaN dt and completes with smootherstep", () => {
    let rig = createRig();
    rig = flyTo(rig, focusBotTarget([2, 1, 0], "dashboard"), [0, 22, 24], [0, -1.5, 0]);
    const stuck = stepRigSmooth(rig, Number.NaN, 1.35);
    assert.equal(stuck.rig.t, 0);
    const mid = stepRigSmooth(rig, 0.4, 1.35);
    assert.ok(mid.rig.t > 0 && mid.rig.t < 1);
    for (const v of [...mid.position, ...mid.lookAt]) assert.ok(Number.isFinite(v));
  });

  it("isGliding treats non-finite t as gliding (refuse picks)", () => {
    const rig = createRig();
    assert.equal(acceptPointerPick({ ...rig, t: Number.NaN }), false);
    assert.equal(acceptPointerPick({ ...rig, t: 1 }), true);
  });
});
