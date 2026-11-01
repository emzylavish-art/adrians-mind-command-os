import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  KEY_LIFT_BRIGHT,
  KEY_LIFT_DARK,
  KEY_LIFT_MAX,
  createSceneKeyLiftPass,
  keyLiftFactor,
  keyLiftGain,
  statsAtFocus,
} from "./scene-key-lift.ts";
import { formatMeterBadge } from "./meter-badge.ts";
import { METER_INTERVAL_MS } from "./backdrop-meter.ts";
import type { UvRect } from "./detail-backdrop-dim.ts";

const stats = (mean: number) => ({ mean, p90: mean * 1.5, max: mean * 2, samples: 64 });
const cam = () => {
  const c = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  c.position.set(0, 0, 10);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};

describe("#83 scene key lift — gain only from a real dark measurement", () => {
  it("no / junk / bright readings → no lift", () => {
    assert.equal(keyLiftGain(null), 0);
    assert.equal(keyLiftGain(undefined), 0);
    assert.equal(keyLiftGain({ mean: NaN, p90: 0, max: 0, samples: 64 }), 0);
    assert.equal(keyLiftGain({ mean: 0.01, p90: 0, max: 0, samples: 0 }), 0);
    assert.equal(keyLiftGain(stats(KEY_LIFT_BRIGHT)), 0);
    assert.equal(keyLiftGain(stats(0.5)), 0);
  });
  it("dark backdrop → full lift, monotonic between", () => {
    assert.equal(keyLiftGain(stats(KEY_LIFT_DARK)), KEY_LIFT_MAX);
    assert.equal(keyLiftGain(stats(0)), KEY_LIFT_MAX);
    const mid = keyLiftGain(stats((KEY_LIFT_DARK + KEY_LIFT_BRIGHT) / 2));
    assert.ok(mid > 0 && mid < KEY_LIFT_MAX);
    assert.ok(keyLiftGain(stats(0.06)) > keyLiftGain(stats(0.1)));
  });
  it("factor lifts shadows, protects highlights, ignores junk", () => {
    assert.equal(keyLiftFactor(0.1, 1, KEY_LIFT_MAX), 1 + KEY_LIFT_MAX);
    assert.equal(keyLiftFactor(0.9, 1, KEY_LIFT_MAX), 1, "highlights never pushed toward clipping");
    assert.equal(keyLiftFactor(0.1, 0, KEY_LIFT_MAX), 1, "outside the falloff untouched");
    assert.equal(keyLiftFactor(NaN, 1, 1), 1);
    assert.ok(keyLiftFactor(0.1, 1, 99) <= 1 + KEY_LIFT_MAX);
  });
  it("statsAtFocus picks the measured rect containing the card, else null", () => {
    const rects: UvRect[] = [
      [0.6, 0.2, 0.95, 0.9],
      [0.05, 0.05, 0.4, 0.3],
    ];
    const report = { perRect: [stats(0.02), stats(0.3)] };
    assert.equal(statsAtFocus(report, rects, [0.7, 0.5])!.mean, 0.02);
    assert.equal(statsAtFocus(report, rects, [0.2, 0.1])!.mean, 0.3);
    assert.equal(statsAtFocus(report, rects, [0.5, 0.5]), null, "card not behind a measured rect");
    assert.equal(statsAtFocus({ perRect: [] }, rects, [0.7, 0.5]), null, "stale report has no perRect");
    assert.equal(statsAtFocus(report, rects, [NaN, 0.5]), null);
    assert.equal(statsAtFocus(null, rects, [0.7, 0.5]), null);
  });
});

describe("#83 scene key lift pass", () => {
  it("starts disabled (byte-identical frame)", () => {
    const h = createSceneKeyLiftPass();
    assert.equal(h.pass.enabled, false);
    assert.equal(h.report.source, "none");
    assert.equal(h.report.backdropMean, null);
    h.dispose();
  });
  it("focused + dark measurement → lifts (reduced motion snaps); unmeasured → off", () => {
    const h = createSceneKeyLiftPass();
    h.setFocus(new THREE.Vector3(0, 0, 0), cam(), 0.1);
    assert.deepEqual(h.focusUv!.map((v) => +v.toFixed(3)), [0.5, 0.5]);
    h.setBackdrop(stats(0.02), { reducedMotion: true });
    assert.equal(h.pass.enabled, true);
    assert.equal(h.report.source, "measured");
    assert.equal(h.report.gain, KEY_LIFT_MAX);
    assert.equal(h.report.backdropMean, 0.02);
    // Key comes from the upper-left of the card.
    const c = (h.pass.uniforms as { center: { value: THREE.Vector2 } }).center.value;
    assert.ok(c.x < 0.5 && c.y > 0.5);
    h.setBackdrop(null, { reducedMotion: true });
    assert.equal(h.pass.enabled, false);
    assert.equal(h.report.source, "none");
    h.dispose();
  });
  it("eases in and out without popping; focus loss fades out", () => {
    const h = createSceneKeyLiftPass();
    h.setFocus(new THREE.Vector3(0, 0, 0), cam(), 0.1);
    h.setBackdrop(stats(0.0));
    h.tick(16);
    const g1 = h.report.gain;
    assert.ok(g1 > 0 && g1 < KEY_LIFT_MAX * 0.2, `eased, got ${g1}`);
    for (let i = 0; i < 200; i++) h.tick(16);
    assert.ok(Math.abs(h.report.gain - KEY_LIFT_MAX) < 1e-3);
    h.setFocus(null, null);
    h.tick(16);
    assert.ok(h.report.gain < KEY_LIFT_MAX && h.report.gain > 0);
    for (let i = 0; i < 300; i++) h.tick(16);
    assert.equal(h.report.gain, 0);
    assert.equal(h.pass.enabled, false);
    h.dispose();
  });
  it("unfocused → a dark reading never lifts anything", () => {
    const h = createSceneKeyLiftPass();
    h.setBackdrop(stats(0.0), { reducedMotion: true });
    assert.equal(h.pass.enabled, false);
    h.dispose();
  });
  it("behind the camera / junk focus → no focus uv, no lift", () => {
    const h = createSceneKeyLiftPass();
    h.setFocus(new THREE.Vector3(0, 0, 50), cam(), 0.1);
    assert.equal(h.focusUv, null);
    h.setFocus(new THREE.Vector3(NaN, 0, 0), cam(), 0.1);
    assert.equal(h.focusUv, null);
    h.setBackdrop(stats(0.0), { reducedMotion: true });
    assert.equal(h.pass.enabled, false);
    h.dispose();
  });
  it("dispose is idempotent and leaves the pass off", () => {
    const h = createSceneKeyLiftPass();
    h.setFocus(new THREE.Vector3(0, 0, 0), cam(), 0.1);
    h.setBackdrop(stats(0.0), { reducedMotion: true });
    h.dispose();
    h.dispose();
    assert.equal(h.pass.enabled, false);
    assert.equal(h.report.gain, 0);
    h.setBackdrop(stats(0.0), { reducedMotion: true });
    assert.equal(h.pass.enabled, false);
  });
});

describe("#83 meter badge — honest text only", () => {
  const nominal = { multiplier: 1, intervalMs: METER_INTERVAL_MS, lastLatencyMs: null, reason: null };
  it("no report → off", () => {
    assert.deepEqual(formatMeterBadge(null), { text: "dim: off", level: "idle" });
  });
  it("static with no read never prints a number", () => {
    const b = formatMeterBadge({ source: "static", backdropLum: null, lastError: null, reads: 0, backoff: nominal });
    assert.equal(b.text, "dim static (no reading) · no read yet · 0 reads");
    assert.equal(b.level, "idle");
    assert.ok(!/\d+ms/.test(b.text));
  });
  it("measured nominal → ok with real values", () => {
    const b = formatMeterBadge({
      source: "measured",
      backdropLum: 0.314,
      lastError: null,
      reads: 7,
      backoff: { ...nominal, lastLatencyMs: 4.4 },
    });
    assert.equal(b.text, "dim measured p90 0.31 · read 4ms · 7 reads");
    assert.equal(b.level, "ok");
  });
  it("back-off and errors surface as warn", () => {
    const b = formatMeterBadge(
      {
        source: "static",
        backdropLum: null,
        lastError: "readback-timeout",
        reads: 3,
        backoff: { multiplier: 4, intervalMs: 2000, lastLatencyMs: 80, reason: "slow-readback" },
      },
      { source: "none", targetGain: 0, gain: 0, backdropMean: null },
    );
    assert.equal(b.text, "dim static (no reading) · read 80ms · ×4 slow-readback (2000ms) · err readback-timeout · 3 reads · key off");
    assert.equal(b.level, "warn");
  });
  it("key lift shows its measured gain", () => {
    const b = formatMeterBadge(
      { source: "measured", backdropLum: 0.02, lastError: null, reads: 2, backoff: { ...nominal, lastLatencyMs: 3 } },
      { source: "measured", targetGain: 0.35, gain: 0.2, backdropMean: 0.02 },
    );
    assert.ok(b.text.endsWith("key +0.35"));
  });
});
