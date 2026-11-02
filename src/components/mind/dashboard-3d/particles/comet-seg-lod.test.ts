/**
 * Motion c31 — comet arc segment LOD by camera distance.
 *
 * Fewer line samples when the camera is far (sub-pixel trails); full segments
 * near. Hysteresis so oscillating at the threshold cannot flicker the count.
 * Head stays at the same world point when the segment count changes (no pop).
 *
 * HACKER (new vs c1–c30):
 *  - camDistance NaN / 0 / negative / Infinity
 *  - camera "inside" a comet (distance ~0) must stay at full segments
 *  - thrash: oscillate across the FAR threshold without hyst → would flicker;
 *    with hyst must hold
 *  - mid-trail segment count change keeps head continuous / finite
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  COMET_SEG_FAR_MIN,
  COMET_SEG_LOD_FAR,
  COMET_SEG_LOD_HYST,
  COMET_SEG_LOD_NEAR,
  createCometSegLodState,
  stepCometSegLod,
} from "./motion-lod.ts";
import {
  COMET_SEGMENTS_DEFAULT,
  createCommitComets,
} from "./commit-comets.ts";
import { createMotionClock } from "../motion/motion-clock.ts";

describe("c31 — cometSegLod pure helper", () => {
  it("near → full segments; far → ≤ FAR_MIN floor band", () => {
    const full = 24;
    const st = createCometSegLodState(full);
    assert.equal(stepCometSegLod(st, COMET_SEG_LOD_NEAR - 1, full), full);
    assert.equal(stepCometSegLod(st, COMET_SEG_LOD_FAR + 5, full), COMET_SEG_FAR_MIN);
  });

  it("hysteresis: oscillating at FAR threshold does not flicker", () => {
    const full = 24;
    const st = createCometSegLodState(full);
    // Enter far
    assert.equal(stepCometSegLod(st, COMET_SEG_LOD_FAR + 1, full), COMET_SEG_FAR_MIN);
    // Dip just below FAR but within hyst band — must STAY thin
    const edge = COMET_SEG_LOD_FAR - COMET_SEG_LOD_HYST / 2;
    assert.ok(edge > COMET_SEG_LOD_NEAR);
    for (let i = 0; i < 40; i++) {
      const d = i % 2 === 0 ? COMET_SEG_LOD_FAR + 0.5 : edge;
      const n = stepCometSegLod(st, d, full);
      assert.equal(n, COMET_SEG_FAR_MIN, `flicker at i=${i} d=${d} → ${n}`);
    }
    // Only recover when clearly inside exit band
    assert.equal(stepCometSegLod(st, COMET_SEG_LOD_FAR - COMET_SEG_LOD_HYST - 1, full), full);
  });
});

describe("hacker c31 — hostile distance + mid-trail change", () => {
  it("NaN / 0 / negative / Infinity distance → safe full (or held) segments, never throw", () => {
    const full = 24;
    const st = createCometSegLodState(full);
    for (const d of [Number.NaN, 0, -10, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.doesNotThrow(() => {
        const n = stepCometSegLod(st, d, full);
        assert.ok(n >= COMET_SEG_FAR_MIN && n <= full, `d=${d} → ${n}`);
      });
    }
    // 0 / near-zero ("inside comet") must not thin
    const st2 = createCometSegLodState(full);
    assert.equal(stepCometSegLod(st2, 0, full), full);
    assert.equal(stepCometSegLod(st2, 1e-8, full), full);
  });

  it("full→0 and 0→full do not throw; active stays in [FAR_MIN, full]", () => {
    const st = createCometSegLodState(24);
    assert.equal(stepCometSegLod(st, 100, 0), 0);
    assert.equal(stepCometSegLod(st, 10, 24), 24);
  });
});

describe("c31 — commit-comets live segment LOD", () => {
  it("far camera thins drawRange; near restores; head world pos continuous across change", () => {
    const scene = new THREE.Scene();
    const clock = createMotionClock();
    const h = createCommitComets(scene, [{ sha: "loddeadbeef01" }, { sha: "loddeadbeef02" }], {
      max: 4,
      segments: COMET_SEGMENTS_DEFAULT,
      clock,
    });
    assert.ok(h.segLod, "handle exposes segLod");
    // Near
    h.setCamDistance?.(COMET_SEG_LOD_NEAR - 2);
    h.update(5, false);
    const line = h.lines![0]!;
    const nearCount = line.geometry.drawRange.count;
    assert.equal(nearCount, COMET_SEGMENTS_DEFAULT);

    const headAttr = h.heads![0]!.geometry.getAttribute("position") as THREE.BufferAttribute;
    const headNear = [headAttr.getX(0), headAttr.getY(0), headAttr.getZ(0)];

    // Far — thinner
    h.setCamDistance?.(COMET_SEG_LOD_FAR + 10);
    h.update(5.2, false);
    const farCount = line.geometry.drawRange.count;
    assert.ok(farCount <= COMET_SEG_FAR_MIN + 1, `far drawRange ${farCount}`);
    assert.ok(farCount < nearCount);

    const headFar = [headAttr.getX(0), headAttr.getY(0), headAttr.getZ(0)];
    // Same mapped-ish motion step: head should move with orbit, but stay finite.
    // Continuity check: after a forced segment change at SAME t, head matches.
    h.update(5.2, false); // duplicate t
    const headFar2 = [headAttr.getX(0), headAttr.getY(0), headAttr.getZ(0)];
    assert.deepEqual(headFar2, headFar);

    // Force segment change at fixed t by toggling distance without advancing clock map oddly:
    // go near again at new t, snap head, then far at SAME t after resetting lod via distance only
    h.setCamDistance?.(COMET_SEG_LOD_NEAR - 2);
    h.update(6.0, false);
    const hx = headAttr.getX(0);
    const hy = headAttr.getY(0);
    const hz = headAttr.getZ(0);
    h.setCamDistance?.(COMET_SEG_LOD_FAR + 20);
    // same wall t → early-out would skip; bump t slightly but compare parametric head at write
    h.update(6.0000001, false);
    assert.ok(Number.isFinite(headAttr.getX(0)) && Number.isFinite(headAttr.getY(0)) && Number.isFinite(headAttr.getZ(0)));
    // Head at s=0 of resampled arc for nearly same phase — displacement tiny vs radius
    const dHead = Math.hypot(headAttr.getX(0) - hx, headAttr.getY(0) - hy, headAttr.getZ(0) - hz);
    assert.ok(dHead < 0.05, `head pop on seg change: ${dHead}`);

    void headNear;
    h.dispose();
  });

  it("threshold thrash on live handle does not flicker drawRange", () => {
    const scene = new THREE.Scene();
    const h = createCommitComets(scene, [{ sha: "thrashcomet01ab" }], { max: 2, segments: 24 });
    h.setCamDistance?.(COMET_SEG_LOD_FAR + 1);
    h.update(1, false);
    const thin = h.lines![0]!.geometry.drawRange.count;
    const edge = COMET_SEG_LOD_FAR - COMET_SEG_LOD_HYST / 2;
    for (let i = 0; i < 30; i++) {
      h.setCamDistance?.(i % 2 === 0 ? COMET_SEG_LOD_FAR + 0.2 : edge);
      h.update(1 + i * 0.05, false);
      assert.equal(h.lines![0]!.geometry.drawRange.count, thin, `flicker frame ${i}`);
    }
    h.dispose();
  });
});
