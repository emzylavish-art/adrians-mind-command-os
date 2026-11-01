import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createCommitComets } from "./commit-comets.ts";
import { createDustField, DUST_COUNT_MAX, seedDustParticles } from "./dust-field.ts";
import { sampleOrbitDrift } from "../motion/orbit-drift.ts";
import { sampleStarPulse, normalizePulseHealth } from "../motion/star-pulse.ts";
import { damp } from "../motion/ease.ts";

describe("hacker pass — motion lane breaks", () => {
  it("comet segments=1 must not produce NaN positions (was /0)", () => {
    const scene = new THREE.Scene();
    const handle = createCommitComets(scene, [{ sha: "deadbeef" }], { segments: 1, max: 1 });
    handle.update(1.25, false);
    const line = handle.group.children[0] as THREE.Line;
    const arr = (line.geometry.getAttribute("position") as THREE.BufferAttribute).array;
    for (let i = 0; i < arr.length; i++) {
      assert.ok(Number.isFinite(arr[i]!), `index ${i} not finite: ${arr[i]}`);
    }
    handle.dispose();
  });

  it("comet segments=0 / negative clamps to safe arc", () => {
    const scene = new THREE.Scene();
    const handle = createCommitComets(scene, [{ sha: "abc" }], { segments: 0 });
    handle.update(0, false);
    assert.ok(handle.count === 1);
    handle.dispose();
  });

  it("empty/malformed commits do not fabricate trails", () => {
    const scene = new THREE.Scene();
    const handle = createCommitComets(scene, [
      { sha: "" },
      { sha: null },
      {},
      { sha: "realsha1" },
    ] as any, { max: 6 });
    assert.equal(handle.count, 1);
    handle.dispose();
  });

  it("null commits list is honest empty", () => {
    const scene = new THREE.Scene();
    const handle = createCommitComets(scene, null as any);
    assert.equal(handle.count, 0);
    handle.update(10, false);
    handle.dispose();
    handle.dispose(); // idempotent
    handle.update(11, false); // after dispose no-op
  });

  it("dust count clamps away from runaway thousands", () => {
    const huge = seedDustParticles(50_000, 10, 8, 1);
    assert.equal(huge.length, DUST_COUNT_MAX);
    const zero = seedDustParticles(0, 10, 8, 1);
    assert.equal(zero.length, 0);
    const neg = seedDustParticles(-9, 10, 8, 1);
    assert.equal(neg.length, 0);
  });

  it("dust create+dispose+update does not throw (unmount leak guard)", () => {
    const scene = new THREE.Scene();
    const dust = createDustField(scene, { count: 32, seed: 1 });
    dust.update(0.5, false);
    dust.update(Number.NaN, false);
    dust.update(1e9, false); // tab-hidden jump
    dust.dispose();
    dust.dispose();
    dust.update(2, false);
    assert.equal(dust.disposed, true);
    assert.equal(dust.mesh, null);
    assert.equal(scene.children.includes(dust.mesh as any), false);
  });

  it("zero dust count is a valid no-mesh handle", () => {
    const scene = new THREE.Scene();
    const dust = createDustField(scene, { count: 0 });
    assert.equal(dust.count, 0);
    assert.equal(dust.mesh, null);
    dust.update(1, false);
    dust.dispose();
  });

  it("orbit drift with NaN base / time stays finite", () => {
    const out = { x: 0, y: 0, z: 0 };
    sampleOrbitDrift(out, { x: Number.NaN, y: 2, z: Number.POSITIVE_INFINITY }, Number.NaN, 1, false);
    assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z));
  });

  it("star pulse with unknown health and NaN time stays finite", () => {
    const out = { scale: 0, glow: 0, emissive: 0 };
    assert.equal(normalizePulseHealth("nope"), "idle");
    sampleStarPulse(out, Number.NaN, Number.NaN, "bogus" as any, false);
    assert.ok(Number.isFinite(out.scale) && Number.isFinite(out.glow) && Number.isFinite(out.emissive));
    sampleStarPulse(out, 1e9, 0, "healthy", true);
    assert.equal(out.scale, 1);
  });

  it("damp with huge dt caps like a single frame (no snap/explode)", () => {
    const spiked = damp(0, 10, 8, 30); // 30s tab resume
    const capped = damp(0, 10, 8, 0.05);
    assert.ok(Number.isFinite(spiked));
    assert.equal(spiked, capped);
    assert.ok(spiked < 10); // one capped step must not finish the ease
    assert.ok(spiked > 0);
  });
});

// Lane suites without their own package.json test entry (lane-only edit rule) ride along here.
import "./hacker-pass-c3.test.ts";
import "./motion-lod.test.ts";
