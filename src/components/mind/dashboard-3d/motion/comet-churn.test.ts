/**
 * Hacker c22 (#91): comet-launch churn under the scene's 5s rebuild + head-size compounding;
 * character reduced-motion exit pop.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMET_HEAD_SIZE_MIN,
  clearCometLaunch,
  cometHeadSize,
  createCometLaunchSample,
  createCometLaunchState,
  reconcileCometLaunch,
  scheduleCometLaunchBurst,
  stepCometLaunchEase,
  type CometLaunchSample,
} from "./comet-launch-ease.ts";
import {
  CHAR_IDLE_BOB_AMP,
  createCharacterMotionState,
  createCharacterSample,
  stepCharacterMotion,
} from "./character-motion.ts";
import { createMotionClock } from "./motion-clock.ts";

const SHAS = ["a1", "b2", "c3", "d4", "e5", "f6"];
const run = (st: ReturnType<typeof createCometLaunchState>, out: CometLaunchSample[], secs: number, rm = false) => {
  for (let i = 0; i < Math.round(secs * 60); i++) stepCometLaunchEase(st, out, 1 / 60, rm);
};

describe("hacker c22 — comet launch churn on 5s rebuild", () => {
  it("old clear+schedule path blinks landed comets (documents the break)", () => {
    const st = createCometLaunchState(24);
    const out = Array.from({ length: 24 }, () => createCometLaunchSample());
    scheduleCometLaunchBurst(st, 6, false);
    run(st, out, 2);
    assert.ok(out.slice(0, 6).every((s) => s.visible && s.opacity === 1));
    clearCometLaunch(st);
    scheduleCometLaunchBurst(st, 6, false);
    stepCometLaunchEase(st, out, 1 / 60, false);
    assert.ok(out.slice(0, 6).some((s) => !s.visible), "legacy path blinks — why reconcile exists");
  });

  it("reconcile with unchanged shas keeps every landed comet fully visible", () => {
    const st = createCometLaunchState(24);
    const out = Array.from({ length: 24 }, () => createCometLaunchSample());
    assert.equal(reconcileCometLaunch(st, SHAS, false), 6);
    run(st, out, 2);
    for (let sync = 0; sync < 5; sync++) {
      assert.equal(reconcileCometLaunch(st, SHAS.slice(), false), 0);
      for (let f = 0; f < 30; f++) {
        stepCometLaunchEase(st, out, 1 / 60, false);
        for (let i = 0; i < 6; i++) assert.equal(out[i]!.opacity, 1, `sync ${sync} frame ${f} comet ${i}`);
      }
    }
  });

  it("only a new head commit launches; shifted list re-keys honestly", () => {
    const st = createCometLaunchState(24);
    const out = Array.from({ length: 24 }, () => createCometLaunchSample());
    reconcileCometLaunch(st, SHAS, false);
    run(st, out, 2);
    // same list, slot 5 changed
    const next = SHAS.slice(0, 5).concat("zz");
    assert.equal(reconcileCometLaunch(st, next, false), 1);
    stepCometLaunchEase(st, out, 1 / 60, false);
    for (let i = 0; i < 5; i++) assert.equal(out[i]!.opacity, 1);
    assert.ok(out[5]!.opacity < 1);
    run(st, out, 1);
    assert.equal(out[5]!.opacity, 1);
  });

  it("in-flight launch with same key keeps easing (no restart)", () => {
    const st = createCometLaunchState(24);
    const out = Array.from({ length: 24 }, () => createCometLaunchSample());
    reconcileCometLaunch(st, ["a"], false);
    run(st, out, 0.15);
    const mid = out[0]!.amount;
    assert.ok(mid > 0 && mid < 1);
    reconcileCometLaunch(st, ["a"], false);
    stepCometLaunchEase(st, out, 1 / 60, false);
    assert.ok(out[0]!.amount > mid);
  });

  it("shrinking list hides gone slots; empty/null/hostile keys never throw", () => {
    const st = createCometLaunchState(24);
    const out = Array.from({ length: 24 }, () => createCometLaunchSample());
    reconcileCometLaunch(st, SHAS, false);
    run(st, out, 2);
    reconcileCometLaunch(st, SHAS.slice(0, 2), false);
    stepCometLaunchEase(st, out, 1 / 60, false);
    assert.equal(out[2]!.visible, false);
    assert.equal(out[0]!.opacity, 1);
    assert.equal(reconcileCometLaunch(st, null, false), 0);
    assert.equal(reconcileCometLaunch(st, [null, undefined, "", 7 as unknown as string], false), 0);
    const huge = "x".repeat(1_000_000);
    assert.equal(reconcileCometLaunch(st, [huge], false), 1);
    assert.equal(reconcileCometLaunch(st, [huge + "y"], false), 0, "key compare capped");
    assert.equal(reconcileCometLaunch(st, Array(10_000).fill("k"), false) <= 24, true);
  });

  it("over maxConcurrent: overflow parks visible, not hidden forever; maxConcurrent=0 launches none", () => {
    const st = createCometLaunchState(24);
    const out = Array.from({ length: 24 }, () => createCometLaunchSample());
    const keys = Array.from({ length: 10 }, (_, i) => `k${i}`);
    assert.equal(reconcileCometLaunch(st, keys, false, { maxConcurrent: 3 }), 3);
    run(st, out, 2);
    for (let i = 0; i < 10; i++) assert.equal(out[i]!.visible, true, `slot ${i}`);
    const st2 = createCometLaunchState(24);
    assert.equal(reconcileCometLaunch(st2, keys, false, { maxConcurrent: 0 }), 0);
  });

  it("reduced-motion: changed keys snap to landed; toggle mid-launch never hides", () => {
    const st = createCometLaunchState(24);
    const out = Array.from({ length: 24 }, () => createCometLaunchSample());
    assert.equal(reconcileCometLaunch(st, SHAS, true), 0);
    stepCometLaunchEase(st, out, 1 / 60, true);
    assert.ok(out.slice(0, 6).every((s) => s.opacity === 1));
    reconcileCometLaunch(st, ["n1", "n2"], false);
    run(st, out, 0.05);
    stepCometLaunchEase(st, out, 1 / 60, true);
    assert.equal(out[0]!.opacity, 1);
    stepCometLaunchEase(st, out, 1 / 60, false);
    assert.equal(out[0]!.opacity, 1);
  });

  it("legacy states without keys are adopted", () => {
    const st = { slots: [{ amount: 1, delay: 0, live: false }] };
    assert.equal(reconcileCometLaunch(st, ["a"], false), 1);
    assert.equal(reconcileCometLaunch(st, ["a"], false), 0);
  });
});

describe("hacker c22 — comet head size never compounds", () => {
  it("legacy per-frame multiply shrinks to floor; cometHeadSize is stable", () => {
    let legacy = 0.2;
    const sample = createCometLaunchSample();
    sample.scale = 0.8;
    for (let i = 0; i < 300; i++) legacy = Math.max(0.12, legacy * (0.85 + 0.15 * sample.scale));
    assert.equal(legacy, 0.12, "legacy compounding hits floor");
    const a = cometHeadSize(0.2, sample, false);
    for (let i = 0; i < 300; i++) assert.equal(cometHeadSize(0.2, sample, false), a);
    sample.scale = 1;
    assert.equal(cometHeadSize(0.2, sample, false), 0.2);
    sample.scale = 0.6;
    assert.ok(Math.abs(cometHeadSize(0.2, sample, false) - 0.17) < 1e-9);
    assert.equal(cometHeadSize(Number.NaN, sample, false), COMET_HEAD_SIZE_MIN);
    assert.equal(cometHeadSize(0.2, null, false), 0.2);
    assert.equal(cometHeadSize(0.2, sample, true), 0.2);
    sample.scale = Number.NaN;
    assert.equal(cometHeadSize(0.2, sample, false), 0.2);
  });
});

describe("hacker c22 — character reduced-motion exit does not pop", () => {
  it("first frame after reduced→normal stays near rest; ramps to full", () => {
    const clock = createMotionClock();
    const st = createCharacterMotionState();
    const out = createCharacterSample();
    let t = 10;
    for (let i = 0; i < 60; i++) stepCharacterMotion(st, out, "bot-a", (t += 1 / 60), 1 / 60, false, { clock });
    stepCharacterMotion(st, out, "bot-a", (t += 1 / 60), 1 / 60, true, { clock });
    assert.equal(out.offsetY, 0);
    stepCharacterMotion(st, out, "bot-a", (t += 1 / 60), 1 / 60, false, { clock });
    assert.ok(Math.abs(out.offsetY) < CHAR_IDLE_BOB_AMP * 0.15, `pop ${out.offsetY}`);
    assert.ok(Math.abs(out.scaleY - 1) < 0.02 * 0.15);
    let maxStep = 0;
    let prev = out.offsetY;
    for (let i = 0; i < 120; i++) {
      stepCharacterMotion(st, out, "bot-a", (t += 1 / 60), 1 / 60, false, { clock });
      maxStep = Math.max(maxStep, Math.abs(out.offsetY - prev));
      prev = out.offsetY;
    }
    assert.equal(st.amp, 1);
    assert.ok(maxStep < CHAR_IDLE_BOB_AMP * 0.2, `max per-frame step ${maxStep}`);
  });

  it("dt=0 resample holds amp; NaN amp recovers; legacy state without amp = full", () => {
    const st = createCharacterMotionState();
    const out = createCharacterSample();
    stepCharacterMotion(st, out, "x", 1, 1 / 60, true);
    for (let i = 0; i < 10; i++) stepCharacterMotion(st, out, "x", 1, 0, false);
    assert.equal(st.amp, 0);
    st.amp = Number.NaN;
    stepCharacterMotion(st, out, "x", 2, 1 / 60, false);
    assert.equal(st.amp, 1);
    const legacy = { loco: 0, lookYaw: 0 };
    stepCharacterMotion(legacy, out, "x", 3, 1 / 60, false);
    assert.equal("amp" in legacy, false);
    assert.ok(Number.isFinite(out.offsetY));
  });
});
