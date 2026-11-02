import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  FOCUS_BAND,
  FOCUS_DEPTH_EASE_MS,
  FOCUS_DEPTH_MAX,
  FOCUS_RAMP,
  createFocusDepthPass,
  focusBandWeight,
} from "./focus-depth.ts";

const cam = () => {
  const c = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  c.position.set(0, 0, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};

describe("focus depth falloff", () => {
  it("band weight: crisp in band, full past ramp, junk → 0", () => {
    assert.equal(focusBandWeight(0.5, 0.5), 0);
    assert.equal(focusBandWeight(0.5 + FOCUS_BAND * 0.9, 0.5), 0);
    assert.equal(focusBandWeight(0.5 + FOCUS_BAND + FOCUS_RAMP, 0.5), 1);
    const mid = focusBandWeight(0.5 + FOCUS_BAND + FOCUS_RAMP / 2, 0.5);
    assert.ok(mid > 0.4 && mid < 0.6);
    assert.equal(focusBandWeight(Number.NaN, 0.5), 0);
    assert.equal(focusBandWeight(0.9, 0.5, FOCUS_BAND, 0), 0);
  });

  it("off with no focus; eases on; behind-camera focus turns it off", () => {
    const f = createFocusDepthPass();
    assert.equal(f.pass.enabled, false);
    f.setFocus(new THREE.Vector3(0, 0, 0), cam());
    f.tick(FOCUS_DEPTH_EASE_MS / 2);
    assert.ok(f.strength > 0 && f.strength < FOCUS_DEPTH_MAX);
    f.tick(FOCUS_DEPTH_EASE_MS);
    assert.ok(Math.abs(f.strength - FOCUS_DEPTH_MAX) < 1e-9);
    assert.equal(f.pass.enabled, true);
    const u = f.pass.uniforms as Record<string, { value: unknown }>;
    const d = u.focusDepth.value as number;
    assert.ok(d > 0 && d < 1, `focus depth ${d}`);
    f.setFocus(new THREE.Vector3(0, 0, 20), cam(), { reducedMotion: true });
    assert.equal(f.strength, 0);
    assert.equal(f.pass.enabled, false);
    f.dispose();
  });

  it("NaN focus is treated as no focus (no silent NaN uniforms)", () => {
    const f = createFocusDepthPass();
    f.setFocus(new THREE.Vector3(Number.NaN, 0, 0), cam(), { reducedMotion: true });
    assert.equal(f.pass.enabled, false);
    const u = f.pass.uniforms as Record<string, { value: unknown }>;
    assert.ok(Number.isFinite(u.focusDepth.value as number));
    f.dispose();
  });

  it("per-instance uniforms; dispose no-ops later calls", () => {
    const a = createFocusDepthPass();
    const b = createFocusDepthPass();
    a.setFogColor(0xff0000);
    const ua = a.pass.uniforms as Record<string, { value: THREE.Color }>;
    const ub = b.pass.uniforms as Record<string, { value: THREE.Color }>;
    assert.notEqual(ua.fogColor.value.getHex(), ub.fogColor.value.getHex());
    a.dispose();
    a.setFocus(new THREE.Vector3(0, 0, 0), cam(), { reducedMotion: true });
    assert.equal(a.pass.enabled, false);
    assert.equal(a.strength, 0);
    assert.doesNotThrow(() => a.dispose());
    b.dispose();
  });
});
