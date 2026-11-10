import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHARACTER_LOOK,
  applyBlink,
  applyGaze,
  applyViseme,
  cameraForFraming,
  createHumanRig,
  jawOpenFor,
} from "./human-rig.ts";

describe("human rig", () => {
  it("builds a full figure with a face, eyes, jaw and body", () => {
    const rig = createHumanRig(CHARACTER_LOOK.eve!);
    for (const name of ["body", "torso", "head", "face", "jaw", "eyeL", "eyeR", "lidL", "lidR", "neck", "shoeL", "shoeR"]) {
      assert.ok(rig.getObjectByName(name), name);
    }
    rig.traverse((obj) => {
      const mesh = obj as { geometry?: { dispose?: () => void }; material?: { dispose?: () => void } | Array<{ dispose?: () => void }> };
      mesh.geometry?.dispose?.();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose?.());
      else material?.dispose?.();
    });
  });

  it("opens the jaw from the viseme instead of a random amount", () => {
    const rig = createHumanRig(CHARACTER_LOOK.eve!);
    applyViseme(rig, "rest");
    const closed = rig.getObjectByName("jaw")!.rotation.x;
    applyViseme(rig, "aa");
    const open = rig.getObjectByName("jaw")!.rotation.x;
    assert.equal(jawOpenFor("aa") > jawOpenFor("ee"), true);
    assert.ok(Math.abs(open) > Math.abs(closed));
    applyBlink(rig, 1);
    assert.ok(rig.getObjectByName("lidL")!.scale.y > 0.5);
    applyGaze(rig, 1000, false);
    assert.notEqual(rig.getObjectByName("eyeL")!.rotation.y, 0);
  });

  it("pulls the camera back for the full body and in for the face", () => {
    const full = cameraForFraming("full");
    const face = cameraForFraming("face");
    assert.ok(full.position[2] > face.position[2]);
    assert.ok(full.target[1] < face.target[1]);
    assert.equal(Object.keys(CHARACTER_LOOK).length, 5);
  });
});
