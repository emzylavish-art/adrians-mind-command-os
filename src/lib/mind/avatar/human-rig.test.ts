import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
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

  it("reads as a woman: hips wider than the waist, shoulders not wider than the hips", () => {
    const rig = createHumanRig(CHARACTER_LOOK.eve!);
    const span = (name: string) => {
      const part = rig.getObjectByName(name);
      assert.ok(part, name);
      part.visible = true;
      const box = new THREE.Box3().setFromObject(part);
      return box.max.x - box.min.x;
    };
    const hips = span("hips");
    const waist = span("waist");
    const left = rig.getObjectByName("shoulderL")!;
    const right = rig.getObjectByName("shoulderR")!;
    const shoulders = Math.abs(left.position.x - right.position.x) + 0.09;
    assert.ok(hips > waist, `hips ${hips} should be wider than waist ${waist}`);
    assert.ok(hips >= shoulders, `hips ${hips} should be at least as wide as shoulders ${shoulders}`);
    assert.ok(rig.getObjectByName("bust"));
    const dress = rig.getObjectByName("dress");
    assert.ok(dress instanceof THREE.Mesh);
    dress.updateWorldMatrix(true, false);
    const band = (y0: number, y1: number) => {
      const pos = dress.geometry.attributes.position;
      assert.ok(pos);
      let min = Infinity;
      let max = -Infinity;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(dress.matrixWorld);
        if (v.y < y0 || v.y > y1) continue;
        min = Math.min(min, v.x);
        max = Math.max(max, v.x);
      }
      return max - min;
    };
    const hipBand = band(0.82, 0.9);
    const waistBand = band(1.02, 1.08);
    const shoulderBand = band(1.31, 1.36);
    assert.ok(hipBand > waistBand, `dress hips ${hipBand} wider than waist ${waistBand}`);
    assert.ok(hipBand >= shoulderBand, `dress hips ${hipBand} at least shoulder width ${shoulderBand}`);
    for (const name of ["bust", "waist", "hips", "shoulderL", "shoulderR"]) {
      rig.getObjectByName(name)!.visible = false;
    }
    assert.equal(dress.visible, true);
    const foreL = rig.getObjectByName("foreL")!;
    const handL = rig.getObjectByName("handL")!;
    assert.equal(foreL.parent?.name, "armL");
    assert.equal(handL.parent?.name, "foreL");
    const neck = rig.getObjectByName("neck")!;
    const head = rig.getObjectByName("head")!;
    const neckBox = new THREE.Box3().setFromObject(neck);
    assert.ok(neckBox.max.y >= head.position.y - 0.01, `neck top ${neckBox.max.y}`);
    const thigh = rig.getObjectByName("thighL")!;
    const thighBox = new THREE.Box3().setFromObject(thigh);
    assert.ok(thighBox.max.y > 0.8, `thigh meets hips at ${thighBox.max.y}`);
  });
});
