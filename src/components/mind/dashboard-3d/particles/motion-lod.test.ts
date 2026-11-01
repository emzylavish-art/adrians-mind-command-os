import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createDustField } from "./dust-field.ts";
import { createCommitComets } from "./commit-comets.ts";
import { createMotionClock } from "../motion/motion-clock.ts";
import {
  createFrameBudget,
  dustDistanceFactor,
  isDocumentHidden,
  lodCount,
  LOD_FAR_FACTOR,
  LOD_MIN_ACTIVE,
} from "./motion-lod.ts";

describe("motion LOD", () => {
  it("distance factor: full near, thinned far, monotonic, NaN-safe", () => {
    assert.equal(dustDistanceFactor(10), 1);
    assert.equal(dustDistanceFactor(500), LOD_FAR_FACTOR);
    assert.equal(dustDistanceFactor(Number.NaN), 1);
    let prev = 1;
    for (let d = 20; d < 80; d += 2) {
      const f = dustDistanceFactor(d);
      assert.ok(f <= prev + 1e-12);
      prev = f;
    }
  });

  it("frame budget shrinks under slow frames, floors, recovers, ignores resume gaps", () => {
    const b = createFrameBudget();
    for (let i = 0; i < 400; i++) b.sample(0.05); // 20fps
    assert.equal(b.multiplier, 0.3);
    const before = b.multiplier;
    b.sample(30); // tab resume gap — not render cost
    b.sample(Number.NaN);
    b.sample(-1);
    assert.equal(b.multiplier, before);
    for (let i = 0; i < 2000; i++) b.sample(1 / 60);
    assert.equal(b.multiplier, 1);
  });

  it("lodCount clamps and never exceeds full / goes below floor", () => {
    assert.equal(lodCount(480, 1, 1), 480);
    assert.equal(lodCount(480, 0, 0), LOD_MIN_ACTIVE);
    assert.equal(lodCount(10, 0, 0), 10);
    assert.equal(lodCount(0, 1, 1), 0);
    assert.equal(lodCount(480, Number.NaN, Number.NaN), 480);
    assert.equal(lodCount(480, 5, 5), 480);
  });

  it("dust thins when the camera is far and under a slow-frame budget", () => {
    const scene = new THREE.Scene();
    const clock = createMotionClock();
    const dust = createDustField(scene, { count: 480, clock });
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 60, 60);
    dust.mesh!.onBeforeRender({} as any, scene, cam, {} as any, {} as any, {} as any);
    let t = 1;
    dust.update(t, false);
    const far = dust.lod.active;
    assert.ok(far < 480 * 0.6, `far active ${far}`);
    assert.equal(dust.mesh!.count, far);
    cam.position.set(0, 11, 18);
    dust.mesh!.onBeforeRender({} as any, scene, cam, {} as any, {} as any, {} as any);
    dust.update((t += 1 / 60), false);
    assert.equal(dust.lod.active, 480);
    for (let i = 0; i < 300; i++) dust.update((t += 0.05), false);
    assert.ok(dust.lod.active < 200, `slow-frame active ${dust.lod.active}`);
    dust.dispose();
  });

  it("lod:false keeps full count", () => {
    const scene = new THREE.Scene();
    const dust = createDustField(scene, { count: 100, lod: false, clock: createMotionClock() });
    for (let i = 0; i < 200; i++) dust.update(i * 0.05, false);
    assert.equal(dust.mesh!.count, 100);
    dust.dispose();
  });

  it("hidden document pauses dust + comets updates", () => {
    const g = globalThis as { document?: { hidden: boolean } };
    const prev = g.document;
    try {
      g.document = { hidden: true };
      assert.equal(isDocumentHidden(), true);
      const scene = new THREE.Scene();
      const clock = createMotionClock();
      const dust = createDustField(scene, { count: 16, clock });
      const snap = Float32Array.from(dust.mesh!.instanceMatrix.array as Float32Array);
      dust.update(5, false);
      assert.deepEqual(Float32Array.from(dust.mesh!.instanceMatrix.array as Float32Array), snap);
      const comets = createCommitComets(scene, [{ sha: "a1" }], { clock });
      const pos = (comets.group.children[0] as THREE.Line).geometry.getAttribute("position") as THREE.BufferAttribute;
      const v = pos.version;
      comets.update(5, false);
      assert.equal(pos.version, v);
      assert.equal(clock.time, 0, "hidden frames must not advance the motion clock");
      dust.dispose();
      comets.dispose();
    } finally {
      if (prev === undefined) delete g.document;
      else g.document = prev;
    }
    assert.equal(isDocumentHidden(undefined), false);
    assert.equal(isDocumentHidden({ hidden: false }), false);
  });
});
