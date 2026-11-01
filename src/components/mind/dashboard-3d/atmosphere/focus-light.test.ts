import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  FOCUS_EASE_MS,
  FOCUS_KEY_INTENSITY,
  createFocusLight,
  focusKeyRgb,
  focusRigPlacement,
  focusRimRgb,
} from "./focus-light.ts";
import { RIM_RGB } from "./health-tone.ts";

describe("focus key/rim light", () => {
  it("places key camera-side and rim behind the node", () => {
    const p = focusRigPlacement([0, 0, 0], [0, 0, 10])!;
    assert.ok(p.key[2] > 0, "key between node and camera");
    assert.ok(p.rim[2] < 0, "rim behind node");
    assert.ok(p.key[1] > 0 && p.rim[1] > 0, "both lifted");
  });

  it("junk input → null placement (no NaN lights)", () => {
    assert.equal(focusRigPlacement([Number.NaN, 0, 0], [0, 0, 10]), null);
    assert.equal(focusRigPlacement([1, 2, 3], [1, 2, 3]), null);
    const down = focusRigPlacement([0, 0, 0], [0, 10, 0])!;
    assert.ok(down.key.every(Number.isFinite));
  });

  it("unknown health rim is neutral idle, never green", () => {
    assert.deepEqual(focusRimRgb(undefined), [...RIM_RGB.idle]);
    assert.deepEqual(focusRimRgb("??"), [...RIM_RGB.idle]);
    for (const c of focusKeyRgb("blocked")) assert.ok(c >= 0.8 && c <= 1, "key stays near-white");
  });

  it("eases in, fades out on clear, snaps under reduced motion", () => {
    const scene = new THREE.Scene();
    const f = createFocusLight(scene);
    assert.equal(f.key.visible, false);
    f.setFocus({ position: [0, 0, 0], camera: [0, 0, 10], health: "healthy" });
    f.tick(FOCUS_EASE_MS / 2);
    assert.ok(f.level > 0 && f.level < 1);
    f.tick(FOCUS_EASE_MS);
    assert.equal(f.level, 1);
    assert.equal(f.key.intensity, FOCUS_KEY_INTENSITY);
    f.setFocus(null, { reducedMotion: true });
    assert.equal(f.level, 0);
    assert.equal(f.key.visible, false);
    f.setFocus({ position: [0, 0, 0], camera: [0, 0, 10] }, { reducedMotion: true });
    assert.equal(f.level, 1);
    assert.equal(f.tone, "idle");
  });

  it("dispose removes lights and later calls no-op", () => {
    const scene = new THREE.Scene();
    const f = createFocusLight(scene);
    const before = scene.children.length;
    f.dispose();
    assert.equal(scene.children.length, before - 3);
    f.setFocus({ position: [0, 0, 0], camera: [0, 0, 10] }, { reducedMotion: true });
    f.tick(1000);
    assert.equal(f.level, 0);
    assert.equal(f.key.visible, false);
    assert.doesNotThrow(() => f.dispose());
  });
});
