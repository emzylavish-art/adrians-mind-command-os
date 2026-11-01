import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createDustField } from "./dust-field.ts";
import { createCommitComets } from "./commit-comets.ts";
import { sampleOrbitDrift } from "../motion/orbit-drift.ts";
import { sampleStarPulse } from "../motion/star-pulse.ts";
import { createMotionClock, sharedMotionClock } from "../motion/motion-clock.ts";

/** Max per-instance displacement between two dust updates. */
function maxDustJump(dust: ReturnType<typeof createDustField>, t0: number, t1: number): number {
  dust.update(t0, false);
  const a = Float32Array.from(dust.mesh!.instanceMatrix.array as Float32Array);
  dust.update(t1, false);
  const b = dust.mesh!.instanceMatrix.array as Float32Array;
  let max = 0;
  for (let i = 0; i < dust.count; i++) {
    const o = i * 16 + 12;
    max = Math.max(max, Math.hypot(b[o]! - a[o]!, b[o + 1]! - a[o + 1]!, b[o + 2]! - a[o + 2]!));
  }
  return max;
}

describe("hacker pass c3 — tab-hidden resume / day-wrap teleports", () => {
  it("dust does not teleport when the tab resumes after 5 minutes hidden", () => {
    const scene = new THREE.Scene();
    const dust = createDustField(scene, { count: 64, seed: 3 });
    dust.update(100, false);
    dust.update(100 + 1 / 60, false);
    // rAF paused while hidden; next frame arrives 300s later
    const jump = maxDustJump(dust, 100 + 2 / 60, 400);
    assert.ok(jump < 0.02, `dust jumped ${jump.toFixed(4)} units in one frame on resume`);
    dust.dispose();
  });

  it("dust does not pop when performance.now crosses the 24h fold", () => {
    const scene = new THREE.Scene();
    const dust = createDustField(scene, { count: 64, seed: 5 });
    dust.update(86399.98, false);
    const jump = maxDustJump(dust, 86399.99, 86400.006);
    assert.ok(jump < 0.02, `dust popped ${jump.toFixed(4)} units at day fold`);
    dust.dispose();
  });

  it("star pulse + orbit drift stay continuous across a hidden-tab gap", () => {
    const out = { scale: 1, glow: 2, emissive: 0.7 };
    const p = { x: 0, y: 0, z: 0 };
    const base = { x: 10, y: 0, z: 0 };
    sampleStarPulse(out, 50, 0.3, "blocked", false);
    sampleOrbitDrift(p, base, 50, 0.3, false);
    const s0 = out.scale;
    const p0 = { ...p };
    sampleStarPulse(out, 50 + 1 / 60, 0.3, "blocked", false);
    sampleOrbitDrift(p, base, 50 + 1 / 60, 0.3, false);
    const s1 = out.scale;
    const p1 = { ...p };
    sampleStarPulse(out, 950, 0.3, "blocked", false);
    sampleOrbitDrift(p, base, 950, 0.3, false);
    const frameStep = Math.abs(s1 - s0);
    assert.ok(Math.abs(out.scale - s1) <= frameStep * 2 + 1e-3, `pulse snapped ${Math.abs(out.scale - s1)}`);
    const moved = Math.hypot(p.x - p1.x, p.y - p1.y, p.z - p1.z);
    const frameMove = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    assert.ok(moved <= frameMove * 2 + 1e-3, `orbit teleported ${moved.toFixed(4)}`);
  });

  it("comet arcs are continuous when recreated every 5s (scene resync) and on resume", () => {
    const scene = new THREE.Scene();
    let c = createCommitComets(scene, [{ sha: "abc123" }], { max: 1 });
    c.update(200, false);
    const head0 = Array.from((c.group.children[0] as THREE.Line).geometry.getAttribute("position").array.slice(0, 3));
    c.dispose();
    c = createCommitComets(scene, [{ sha: "abc123" }], { max: 1 });
    c.update(200 + 1 / 60, false);
    c.update(800, false); // hidden gap
    const head1 = Array.from((c.group.children[0] as THREE.Line).geometry.getAttribute("position").array.slice(0, 3));
    const d = Math.hypot(head1[0]! - head0[0]!, head1[1]! - head0[1]!, head1[2]! - head0[2]!);
    assert.ok(d < 0.2, `comet head teleported ${d.toFixed(3)}`);
    c.dispose();
  });
});

describe("motion clock", () => {
  it("is idempotent within a frame, monotonic, and gap-clamped", () => {
    const k = createMotionClock({ maxGap: 0.25, nominalStep: 1 / 60 });
    const a = k.map(10);
    assert.equal(k.map(10), a);
    const b = k.map(10.1);
    assert.ok(Math.abs(b - a - 0.1) < 1e-9);
    const c = k.map(5000);
    assert.ok(Math.abs(c - b - 1 / 60) < 1e-9);
    const d = k.map(4000); // clock went backwards
    assert.ok(d > c);
    assert.equal(k.map(Number.NaN), d);
    assert.equal(k.map(Number.POSITIVE_INFINITY), d);
    assert.ok(Number.isFinite(k.lastWallDt));
  });

  it("shared clock is exported for cross-module continuity", () => {
    assert.equal(typeof sharedMotionClock.map, "function");
  });
});
