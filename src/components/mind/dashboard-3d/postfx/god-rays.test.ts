import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createGodRayPass, godRayIntensity, sunScreenUv } from "./god-rays.ts";

describe("god-rays", () => {
  it("intensity rises with healthy ratio and is off with no data / reduced motion", () => {
    assert.equal(godRayIntensity({ healthy: 0, total: 0, reducedMotion: false }), 0);
    assert.equal(godRayIntensity({ healthy: 5, total: 10, reducedMotion: true }), 0);
    assert.equal(godRayIntensity({ healthy: Number.NaN, total: 10, reducedMotion: false }), 0);
    const lo = godRayIntensity({ healthy: 2, total: 10, reducedMotion: false });
    const hi = godRayIntensity({ healthy: 10, total: 10, reducedMotion: false });
    assert.ok(lo > 0 && hi > lo && hi <= 0.8 + 1e-9);
  });

  it("sun behind the camera is invisible; in front projects into the frame", () => {
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const front = sunScreenUv(new THREE.Vector3(0, 0, 0), cam);
    assert.equal(front.visible, true);
    assert.ok(Math.abs(front.uv[0] - 0.5) < 1e-6 && Math.abs(front.uv[1] - 0.5) < 1e-6);
    assert.equal(sunScreenUv(new THREE.Vector3(0, 0, 30), cam).visible, false);
  });

  it("pass is disabled when off, enabled when healthy, and disposes idempotently", () => {
    const g = createGodRayPass();
    assert.equal(g.pass.enabled, false);
    g.update({ healthy: 8, total: 10, reducedMotion: false, tone: "healthy" });
    assert.equal(g.pass.enabled, true);
    g.update({ healthy: 8, total: 10, reducedMotion: true });
    assert.equal(g.pass.enabled, false);
    assert.doesNotThrow(() => g.update({ healthy: 1, total: 2, reducedMotion: false, tone: "??" as never }));
    g.setDepthTexture(new THREE.DepthTexture(4, 4));
    g.dispose();
    assert.doesNotThrow(() => g.dispose());
  });

  it("two passes do not share uniform objects", () => {
    const a = createGodRayPass();
    const b = createGodRayPass();
    assert.notEqual(
      (a.pass.uniforms as { sunUv: { value: unknown } }).sunUv.value,
      (b.pass.uniforms as { sunUv: { value: unknown } }).sunUv.value,
    );
  });
});
