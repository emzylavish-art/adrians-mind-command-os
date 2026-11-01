import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createGodRayPass } from "./god-rays.ts";
import { createTunedBloomPass } from "./bloom-tuning.ts";
import { createColorGradePass } from "./color-grade.ts";

/**
 * Hacker pass (light cycle 3): after unmount/dispose, update/setSize/setSun must
 * no-op. Otherwise a StrictMode remount race or late RAF tick re-enables a
 * disposed ShaderPass / reallocates bloom mip targets (silent WebGL failure or leak).
 */
describe("post-dispose no-op (hacker cycle 3)", () => {
  it("god-ray update/setSun after dispose must not re-enable the disposed pass", () => {
    const g = createGodRayPass();
    g.update({ healthy: 8, total: 10, reducedMotion: false, tone: "healthy" });
    assert.equal(g.pass.enabled, true);
    g.dispose();
    // Intentionally poke every mutator after dispose.
    g.update({ healthy: 8, total: 10, reducedMotion: false, tone: "healthy" });
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.updateMatrixWorld();
    g.setSun(new THREE.Vector3(0, 0, 0), cam);
    g.setDepthTexture(new THREE.DepthTexture(4, 4), cam);
    assert.equal(g.pass.enabled, false, "update after dispose must stay disabled");
    assert.equal(g.intensity, 0, "intensity after dispose must read 0");
  });

  it("bloom setSize/update after dispose must not throw (high-DPR resize race)", () => {
    const bloom = createTunedBloomPass(new THREE.Vector2(64, 64), "idle");
    bloom.dispose();
    assert.doesNotThrow(() => bloom.setSize(1920 * 3, 1080 * 3));
    assert.doesNotThrow(() => bloom.update("blocked"));
    assert.doesNotThrow(() => bloom.dispose());
  });

  it("color-grade dispose is idempotent; update after dispose does not throw", () => {
    const grade = createColorGradePass("idle");
    grade.dispose();
    assert.doesNotThrow(() => grade.dispose());
    assert.doesNotThrow(() => grade.update("healthy"));
  });
});
