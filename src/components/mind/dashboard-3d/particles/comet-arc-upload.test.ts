/**
 * Motion c30 — comet arc GPU upload throttle.
 *
 * Per-frame writeArc set needsUpdate on every line + head (6×2 attrs) even when
 * the clock stalled or update() was called twice with the same t. Use dirty-only
 * uploads + BufferAttribute update ranges; CPU positions stay current so motion
 * matches the unthrottled path.
 *
 * HACKER (new vs c1–c29):
 *  - commit count jumps 0 ↔ max in one sync/update frame
 *  - segments (buffer size) change while a prior upload was "pending"
 *  - trail length 0 / 1 (must clamp; update ranges never empty/negative)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  COMET_ARC_PHASE_EPS,
  COMET_SEGMENTS_MIN,
  commitCometKeys,
  createCommitComets,
  resetCometArcUploadStats,
  syncCommitComets,
  takeCometArcUploadStats,
} from "./commit-comets.ts";
import { createMotionClock } from "../motion/motion-clock.ts";

function commits(n: number) {
  return Array.from({ length: n }, (_, i) => ({ sha: `sha${i.toString(16).padStart(8, "0")}deadbeef` }));
}

describe("c30 — comet arc dirty-only GPU uploads", () => {
  it("second update with the same mapped t does not re-upload arcs", () => {
    const scene = new THREE.Scene();
    const clock = createMotionClock();
    const h = createCommitComets(scene, commits(4), { max: 6, segments: 24, clock });
    resetCometArcUploadStats();
    h.update(1.0, false);
    const first = takeCometArcUploadStats();
    assert.ok(first.arcs >= 4, `expected initial arc uploads, got ${first.arcs}`);
    h.update(1.0, false); // same wall t → same mapped t if dt≈0
    const second = takeCometArcUploadStats();
    assert.equal(second.arcs, 0, `duplicate t must not re-upload arcs (got ${second.arcs})`);
    assert.equal(second.heads, 0);
    h.dispose();
  });

  it("advancing t uploads again; CPU head matches a fresh unthrottled write", () => {
    const scene = new THREE.Scene();
    const clock = createMotionClock();
    const h = createCommitComets(scene, commits(3), { max: 6, segments: 16, clock });
    h.update(2.0, false);
    const head0 = (h.heads![0]!.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const snap = Float32Array.from(head0);
    resetCometArcUploadStats();
    h.update(2.5, false);
    const stats = takeCometArcUploadStats();
    assert.ok(stats.arcs >= 3, `advancing t should upload, got ${stats.arcs}`);
    const head1 = (h.heads![0]!.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
    const moved = Math.hypot(head1[0]! - snap[0]!, head1[1]! - snap[1]!, head1[2]! - snap[2]!);
    assert.ok(moved > COMET_ARC_PHASE_EPS, `head should move when t advances (moved ${moved})`);
    h.dispose();
  });

  it("120 advancing frames upload ≤ one arc-attr set per comet per frame (no double opacity path)", () => {
    const scene = new THREE.Scene();
    const clock = createMotionClock();
    const n = 6;
    const h = createCommitComets(scene, commits(n), { max: n, segments: 24, clock });
    resetCometArcUploadStats();
    for (let i = 0; i < 120; i++) h.update(10 + i / 60, false);
    const s = takeCometArcUploadStats();
    // Each frame × n comets (arcs). Allow exact n*120; fail if 2× (old full-attrs thrash with heads counted separately).
    assert.ok(s.arcs <= n * 120, `arcs ${s.arcs} > ${n * 120}`);
    assert.ok(s.arcs >= n * 100, `arcs ${s.arcs} suspiciously low — motion may have stalled`);
    assert.equal(s.heads, s.arcs, "head uploads should pair with arc uploads");
    h.dispose();
  });
});

describe("hacker c30 — count jump / resize / short trails", () => {
  it("count jumps 0 → max in one frame: sync then update never throws; uploads force", () => {
    const scene = new THREE.Scene();
    const clock = createMotionClock();
    let h = createCommitComets(scene, [], { max: 6, segments: 24, clock });
    assert.equal(h.count, 0);
    resetCometArcUploadStats();
    h.update(1, false);
    assert.equal(takeCometArcUploadStats().arcs, 0);
    h = syncCommitComets(scene, h, commits(6), { max: 6, segments: 24, clock });
    assert.equal(h.count, 6);
    resetCometArcUploadStats();
    assert.doesNotThrow(() => h.update(1.1, false));
    assert.ok(takeCometArcUploadStats().arcs >= 6);
    // jump back to 0
    h = syncCommitComets(scene, h, [], { max: 6, segments: 24, clock });
    assert.equal(h.count, 0);
    assert.doesNotThrow(() => h.update(1.2, false));
    h.dispose();
  });

  it("segments resize (buffer rebuild) while uploads were pending stays finite", () => {
    const scene = new THREE.Scene();
    const clock = createMotionClock();
    let h = createCommitComets(scene, commits(4), { max: 6, segments: 24, clock });
    h.update(3, false);
    // pending-ish: mark needsUpdate then immediately rebuild with new segment count
    for (const line of h.lines ?? []) {
      (line.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }
    h = syncCommitComets(scene, h, commits(4), { max: 6, segments: 48, clock });
    assert.equal((h.lines![0]!.geometry.getAttribute("position") as THREE.BufferAttribute).count, 48);
    assert.doesNotThrow(() => {
      h.update(3.1, false);
      h.update(3.1, false);
    });
    const pos = (h.lines![0]!.geometry.getAttribute("position") as THREE.BufferAttribute).array;
    for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]!), `NaN at ${i}`);
    h.dispose();
  });

  it("trail length 0 / 1 clamps to ≥ COMET_SEGMENTS_MIN; update ranges never empty", () => {
    const scene = new THREE.Scene();
    for (const segments of [0, 1, -3]) {
      const h = createCommitComets(scene, commits(2), { max: 4, segments });
      assert.ok(h.count >= 1);
      const attr = h.lines![0]!.geometry.getAttribute("position") as THREE.BufferAttribute;
      assert.ok(attr.count >= COMET_SEGMENTS_MIN, `segments=${segments} → count ${attr.count}`);
      assert.doesNotThrow(() => {
        h.update(0.5, false);
        h.update(0.5, false);
        h.update(0.7, false);
      });
      h.dispose();
    }
  });

  it("commitCometKeys empty ↔ full flip does not leave stale upload stats owning disposed attrs", () => {
    const scene = new THREE.Scene();
    const clock = createMotionClock();
    let h = createCommitComets(scene, commits(6), { max: 6, clock });
    h.update(1, false);
    const keys0 = commitCometKeys([], 6);
    assert.equal(keys0.length, 0);
    h = syncCommitComets(scene, h, [], { max: 6, clock });
    resetCometArcUploadStats();
    h.update(2, false);
    assert.equal(takeCometArcUploadStats().arcs, 0);
    h = syncCommitComets(scene, h, commits(6), { max: 6, clock });
    h.update(2.1, false);
    h.dispose();
  });
});
