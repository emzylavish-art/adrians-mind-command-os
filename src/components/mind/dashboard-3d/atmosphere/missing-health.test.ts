import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createHealthAtmosphere } from "./health-lights.ts";
import { AMBIENT_RGB, deriveFleetTone, normalizeHealthTone } from "./health-tone.ts";
import { createTunedBloomPass, BLOOM_BY_TONE } from "../postfx/bloom-tuning.ts";
import { createColorGradePass, GRADE_BY_TONE } from "../postfx/color-grade.ts";

/**
 * Hacker pass (light cycle 2): missing / malformed health data must fall back
 * to the neutral "idle" tone — never crash the render loop, never read as green.
 */
const BAD: unknown[] = [undefined, null, "", "unknown", "HEALTHY", 42, {}, Number.NaN];

describe("missing health data → neutral, no crash", () => {
  it("normalizeHealthTone maps junk to idle (not healthy)", () => {
    for (const v of BAD) assert.equal(normalizeHealthTone(v), "idle", String(v));
    assert.equal(normalizeHealthTone("blocked"), "blocked");
  });

  it("deriveFleetTone ignores junk entries instead of trusting them", () => {
    assert.equal(deriveFleetTone(BAD as never[]), "idle");
    assert.equal(deriveFleetTone([undefined, "healthy"] as never[]), "healthy");
  });

  it("atmosphere.update(undefined) does not throw and lands on idle colors", () => {
    const scene = new THREE.Scene();
    const atm = createHealthAtmosphere(scene, { tone: "healthy" });
    for (const v of BAD) assert.doesNotThrow(() => atm.update(v as never), String(v));
    const [r, g, b] = AMBIENT_RGB.idle.map((v) => Math.round(v * 255));
    assert.equal(atm.ambient.color.getHex(), (r << 16) | (g << 8) | b);
    atm.dispose();
  });

  it("createHealthAtmosphere with junk initial tone does not throw", () => {
    const scene = new THREE.Scene();
    assert.doesNotThrow(() => createHealthAtmosphere(scene, { tone: "nope" as never }).dispose());
  });

  it("bloom + grade update(undefined) fall back to idle tuning", () => {
    const bloom = createTunedBloomPass(new THREE.Vector2(64, 64), "blocked");
    assert.doesNotThrow(() => bloom.update(undefined as never));
    assert.equal(bloom.pass.strength, BLOOM_BY_TONE.idle.strength);
    bloom.dispose();
    const grade = createColorGradePass("unknown" as never);
    assert.equal(
      (grade.pass.uniforms as { contrast: { value: number } }).contrast.value,
      GRADE_BY_TONE.idle.contrast,
    );
    grade.dispose();
  });
});
