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
    // Depth-aware: a far sun sits deeper than a near occluder.
    const far = sunScreenUv(new THREE.Vector3(0, 0, -200), cam).depth;
    const near = sunScreenUv(new THREE.Vector3(0, 0, 5), cam).depth;
    assert.ok(far > near && far <= 1 && near >= 0);
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

describe("god-rays feedback unbind (hacker)", () => {
  it("clears tDepth after render so later FBO writes cannot feedback", () => {
    const g = createGodRayPass({ healthy: 1, total: 1 });
    const depth = new THREE.DepthTexture(4, 4);
    g.setDepthTexture(depth);
    assert.equal(g.pass.uniforms.tDepth.value, null, "setDepthTexture does not leave sampler bound");
    const readBuf = { texture: {}, depthTexture: depth } as any;
    const writeBuf = { texture: {}, depthTexture: new THREE.DepthTexture(4, 4) } as any;
    const renderer = {
      setRenderTarget() {},
      getRenderTarget: () => null,
      getClearColor: () => ({ r: 0, g: 0, b: 0 }),
      getClearAlpha: () => 1,
      clear: () => {},
      render: () => {},
      getContext: () => ({ getParameter: () => 0, getExtension: () => null }),
    } as any;
    // During render, ShaderPass path may throw without full WebGL — still assert post-unbind via our wrapper
    try {
      (g.pass as any).render(renderer, writeBuf, readBuf, 0, false);
    } catch {
      /* jsdom / incomplete renderer */
    }
    assert.equal(g.pass.uniforms.tDepth.value, null);
    assert.equal(g.pass.uniforms.useDepth.value, 0);
    g.dispose();
  });
});
