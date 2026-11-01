import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createHealthAtmosphere } from "./health-lights.ts";

/**
 * Hacker pass (light cycle 4): after unmount/dispose, atmosphere.update must
 * not resurrect FogExp2 or re-tint disposed lights (silent post-unmount mutation).
 */
describe("atmosphere post-dispose no-op (hacker cycle 4)", () => {
  it("update after dispose must not resurrect fog or re-add lights", () => {
    const scene = new THREE.Scene();
    const atm = createHealthAtmosphere(scene, { tone: "idle", attachFog: true });
    assert.ok(scene.fog instanceof THREE.FogExp2);
    assert.equal(scene.children.length, 3);
    atm.dispose();
    assert.equal(scene.fog, null);
    assert.equal(scene.children.length, 0);
    atm.update("blocked");
    assert.equal(scene.fog, null, "update after dispose must not resurrect fog");
    assert.equal(scene.children.length, 0, "must not re-add lights");
    assert.doesNotThrow(() => atm.dispose());
  });

  it("attachFog:false update after dispose must not write scene.fog", () => {
    const scene = new THREE.Scene();
    const owned = new THREE.FogExp2(0x050814, 0.018);
    scene.fog = owned;
    const atm = createHealthAtmosphere(scene, { tone: "idle", attachFog: false });
    atm.dispose();
    assert.equal(scene.fog, owned);
    atm.update("blocked");
    assert.equal(scene.fog, owned, "must not replace foreign fog after dispose");
    assert.equal((scene.fog as THREE.FogExp2).density, 0.018, "must not mutate foreign fog density");
  });
});
