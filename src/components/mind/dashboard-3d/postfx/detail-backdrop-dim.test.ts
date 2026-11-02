import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  DIM_EASE_MS,
  DIM_MAX,
  DIM_PAD_PX,
  createDetailBackdropDimPass,
  dimFactor,
  rectMask,
  rectToUv,
} from "./detail-backdrop-dim.ts";
import { createContextLossRecovery } from "./context-loss.ts";

const vp = { left: 0, top: 0, width: 1000, height: 500 };

describe("detail backdrop dim (#60)", () => {
  it("rectToUv flips y, pads, clamps; junk/off-canvas → null", () => {
    const r = rectToUv({ left: 600, top: 100, width: 300, height: 200 }, vp, 0)!;
    assert.deepEqual(r.map((v) => +v.toFixed(3)), [0.6, 0.4, 0.9, 0.8]);
    const p = rectToUv({ left: 600, top: 100, width: 300, height: 200 }, vp)!;
    assert.ok(Math.abs(p[0] - (600 - DIM_PAD_PX) / 1000) < 1e-9);
    // canvas offset in page
    const o = rectToUv({ left: 700, top: 150, width: 300, height: 200 }, { left: 100, top: 50, width: 1000, height: 500 }, 0)!;
    assert.deepEqual(o.map((v) => +v.toFixed(3)), [0.6, 0.4, 0.9, 0.8]);
    assert.deepEqual(rectToUv({ left: 900, top: -50, width: 400, height: 100 }, vp, 0), [0.9, 0.9, 1, 1]);
    assert.equal(rectToUv({ left: 2000, top: 0, width: 10, height: 10 }, vp), null);
    assert.equal(rectToUv({ left: 0, top: 0, width: 0, height: 10 }, vp), null);
    assert.equal(rectToUv({ left: NaN, top: 0, width: 10, height: 10 }, vp), null);
    assert.equal(rectToUv({ left: 0, top: 0, width: 10, height: 10 }, { width: 0, height: 500 }), null);
    assert.equal(rectToUv(null, vp), null);
  });

  it("DPR-independent: same CSS rect → same UV regardless of drawing-buffer size", () => {
    const a = rectToUv({ left: 10, top: 10, width: 100, height: 100 }, vp);
    // Caller always passes CSS sizes; drawing buffer (×DPR) never enters the maths.
    assert.deepEqual(a, rectToUv({ left: 10, top: 10, width: 100, height: 100 }, { ...vp }));
  });

  it("rectMask + dimFactor: dims bright inside, leaves dark + outside alone", () => {
    const r: [number, number, number, number] = [0.6, 0.4, 0.9, 0.8];
    assert.equal(rectMask(0.7, 0.5, r, 0.02, 0.04), 1);
    assert.equal(rectMask(0.1, 0.1, r, 0.02, 0.04), 0);
    const edge = rectMask(0.91, 0.5, r, 0.02, 0.04);
    assert.ok(edge > 0 && edge < 1, "feathered");
    assert.equal(dimFactor(0.05, 1, DIM_MAX), 1, "dark backdrop untouched");
    assert.ok(Math.abs(dimFactor(0.9, 1, DIM_MAX) - (1 - DIM_MAX)) < 1e-9, "bright nebula dimmed");
    assert.equal(dimFactor(0.9, 0, DIM_MAX), 1, "outside rect untouched");
    assert.equal(dimFactor(NaN, 1, 1), 1);
  });

  it("pass: off with no rects (zero cost), eases in/out, reduced snaps, max 2 rects", () => {
    const d = createDetailBackdropDimPass();
    assert.equal(d.pass.enabled, false);
    d.setRects([null, { left: NaN, top: 0, width: 1, height: 1 }], vp);
    assert.equal(d.pass.enabled, false, "junk only → off");
    const card = { left: 600, top: 100, width: 300, height: 200 };
    const chart = { left: 50, top: 300, width: 400, height: 150 };
    d.setRects([card, chart, card], vp);
    assert.equal(d.rects.length, 2);
    d.tick(DIM_EASE_MS / 2);
    assert.ok(d.strength > 0 && d.strength < DIM_MAX);
    assert.equal(d.pass.enabled, true);
    d.tick(DIM_EASE_MS);
    assert.ok(Math.abs(d.strength - DIM_MAX) < 1e-9);
    const u = d.pass.uniforms as { rectCount: { value: number }; feather: { value: THREE.Vector2 } };
    assert.equal(u.rectCount.value, 2);
    assert.ok(Math.abs(u.feather.value.x - 28 / 1000) < 1e-9);
    // close: fades out, keeps rects during fade, clears at 0
    d.setRects(null, vp);
    d.tick(DIM_EASE_MS / 2);
    assert.ok(d.strength > 0 && d.rects.length === 2);
    d.tick(DIM_EASE_MS);
    assert.equal(d.strength, 0);
    assert.equal(d.pass.enabled, false);
    assert.equal(d.rects.length, 0);
    d.setRects([card], vp, { reducedMotion: true });
    assert.ok(Math.abs(d.strength - DIM_MAX) < 1e-9, "reduced motion snaps on");
    d.setRects([], vp, { reducedMotion: true });
    assert.equal(d.pass.enabled, false);
    d.dispose();
    d.setRects([card], vp, { reducedMotion: true });
    assert.equal(d.strength, 0, "disposed no-op");
  });

  it("setHole uses projected focus uv (#57); off-screen/junk clears", () => {
    const d = createDetailBackdropDimPass();
    const cam = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    d.setHole(new THREE.Vector3(0, 0, 0), cam, 0.2);
    const u = d.pass.uniforms as { holeRadius: { value: number }; holeUv: { value: THREE.Vector2 }; aspect: { value: number } };
    assert.ok(Math.abs(u.holeUv.value.x - 0.5) < 1e-6);
    assert.equal(u.holeRadius.value, 0.2);
    assert.equal(u.aspect.value, 2);
    d.setHole(new THREE.Vector3(0, 0, 20), cam, 0.2);
    assert.equal(u.holeRadius.value, 0, "behind camera");
    d.setHole(null, cam);
    assert.equal(u.holeRadius.value, 0);
    d.dispose();
  });

  it("context-loss bundle disposes detailDim", () => {
    const d = createDetailBackdropDimPass();
    let disposed = 0;
    const orig = d.dispose;
    d.dispose = () => {
      disposed += 1;
      orig();
    };
    const r = createContextLossRecovery({ initial: { detailDim: d } });
    r.notifyLost();
    assert.equal(disposed, 1);
    r.dispose();
  });
});
