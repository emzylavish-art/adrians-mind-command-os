import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BREADCRUMB_SLIDE_PX,
  clearBreadcrumbFocus,
  createBreadcrumbEaseSample,
  createBreadcrumbEaseState,
  setBreadcrumbFocus,
  stepBreadcrumbEase,
} from "./breadcrumb-ease.ts";
import {
  CHAR_PHASE_ID_MAX,
  characterPhaseFromId,
  createCharacterMotionState,
  createCharacterSample,
  sanitizeCharacterSpeed,
  stepCharacterMotion,
} from "./character-motion.ts";
import { createMotionClock, hardResetSharedMotionClockForTests, sharedMotionClock } from "./motion-clock.ts";
import { sampleOrbitDrift } from "./orbit-drift.ts";
import { stepNodeOpen, createNodeOpenState, createNodeOpenSample } from "./transition-ease.ts";
import { stepFocusEase, createFocusEaseState } from "./focus-ease.ts";
import {
  beginSceneTransition,
  createSceneTransitionSample,
  createSceneTransitionState,
  stepSceneTransition,
} from "./transition-ease.ts";

describe("breadcrumb-ease", () => {
  it("eases in opacity/slide then settles; empty id hides", () => {
    const st = createBreadcrumbEaseState();
    const out = createBreadcrumbEaseSample();
    setBreadcrumbFocus(st, "bot:logic");
    for (let i = 0; i < 60; i++) stepBreadcrumbEase(st, out, 1 / 60, false);
    assert.equal(out.done, true);
    assert.equal(out.opacity, 1);
    assert.equal(out.offsetX, 0);
    assert.equal(out.focusId, "bot:logic");
    setBreadcrumbFocus(st, "");
    assert.equal(st.target, 0);
    for (let i = 0; i < 60; i++) stepBreadcrumbEase(st, out, 1 / 60, false);
    assert.equal(out.opacity, 0);
    assert.equal(out.focusId, null);
  });

  it("clear mid-enter eases out from current amount (interruptible)", () => {
    const st = createBreadcrumbEaseState();
    const out = createBreadcrumbEaseSample();
    setBreadcrumbFocus(st, "bot:a");
    for (let i = 0; i < 6; i++) stepBreadcrumbEase(st, out, 1 / 60, false);
    const mid = out.amount;
    assert.ok(mid > 0.05 && mid < 0.95, `mid ${mid}`);
    clearBreadcrumbFocus(st);
    stepBreadcrumbEase(st, out, 1 / 60, false);
    assert.ok(out.amount < mid);
    assert.ok(out.amount > mid - 0.25);
    assert.equal(out.focusId, "bot:a"); // kept during exit
  });

  it("focus id change while open keeps amount; reduced-motion snaps", () => {
    const st = createBreadcrumbEaseState();
    const out = createBreadcrumbEaseSample();
    setBreadcrumbFocus(st, "bot:a");
    for (let i = 0; i < 40; i++) stepBreadcrumbEase(st, out, 1 / 60, false);
    assert.equal(out.amount, 1);
    setBreadcrumbFocus(st, "bot:b");
    stepBreadcrumbEase(st, out, 1 / 60, false);
    assert.equal(out.amount, 1);
    assert.equal(out.focusId, "bot:b");
    clearBreadcrumbFocus(st);
    stepBreadcrumbEase(st, out, 0, true);
    assert.equal(out.amount, 0);
    assert.equal(out.opacity, 0);
    assert.ok(Math.abs(out.offsetX - -BREADCRUMB_SLIDE_PX) < 1e-9);
  });

  it("unknown/null focus and dt edges stay finite", () => {
    const st = createBreadcrumbEaseState();
    const out = createBreadcrumbEaseSample();
    setBreadcrumbFocus(st, null);
    stepBreadcrumbEase(st, out, Number.POSITIVE_INFINITY, false);
    assert.equal(out.amount, 0);
    setBreadcrumbFocus(st, "bot:x");
    stepBreadcrumbEase(st, out, Number.NaN, false);
    assert.ok(Number.isFinite(out.opacity) && Number.isFinite(out.offsetX));
  });
});

describe("hacker c8 — opts alloc + speed Infinity + phase id + hardReset", () => {
  it("sanitizeCharacterSpeed: +Infinity → 1, NaN/neg → 0, huge → 1", () => {
    assert.equal(sanitizeCharacterSpeed(Number.POSITIVE_INFINITY), 1);
    assert.equal(sanitizeCharacterSpeed(Number.NaN), 0);
    assert.equal(sanitizeCharacterSpeed(Number.NEGATIVE_INFINITY), 0);
    assert.equal(sanitizeCharacterSpeed(-2), 0);
    assert.equal(sanitizeCharacterSpeed(1e9), 1);
    assert.equal(sanitizeCharacterSpeed(0.4), 0.4);
  });

  it("stepCharacterMotion with +Infinity speed walks (not idle)", () => {
    const st = createCharacterMotionState();
    const out = createCharacterSample();
    const clock = createMotionClock();
    for (let i = 0; i < 90; i++) {
      stepCharacterMotion(st, out, "w", i / 60, 1 / 60, false, { speed: Number.POSITIVE_INFINITY, clock });
    }
    assert.ok(st.loco > 0.9, `loco ${st.loco}`);
  });

  it("characterPhaseFromId handles unicode/long ids; caps cost", () => {
    const u = characterPhaseFromId("🤖✨");
    assert.ok(Number.isFinite(u) && u >= 0 && u < Math.PI * 2);
    const long = "x".repeat(CHAR_PHASE_ID_MAX + 5000);
    const a = characterPhaseFromId(long);
    const b = characterPhaseFromId(long.slice(0, CHAR_PHASE_ID_MAX));
    assert.equal(a, b);
    assert.equal(characterPhaseFromId(""), characterPhaseFromId(null));
  });

  it("hot-path step* without opts allocates no Arrays over 10k frames", () => {
    let created = 0;
    const Orig = Array;
    globalThis.Array = new Proxy(Orig, {
      construct(t, args) {
        created++;
        return Reflect.construct(t, args);
      },
      apply(t, th, args) {
        created++;
        return Reflect.apply(t, th, args);
      },
    }) as ArrayConstructor;
    try {
      const clock = createMotionClock();
      const cs = createCharacterMotionState();
      const co = createCharacterSample();
      const ns = createNodeOpenState(false);
      ns.target = 1;
      const no = createNodeOpenSample();
      const fs = createFocusEaseState();
      const ss = createSceneTransitionState();
      beginSceneTransition(ss, "universe", "city");
      const so = createSceneTransitionSample();
      const bs = createBreadcrumbEaseState();
      setBreadcrumbFocus(bs, "bot:a");
      const bo = createBreadcrumbEaseSample();
      const drift = { x: 0, y: 0, z: 0 };
      const base = { x: 1, y: 0, z: 0 };
      created = 0;
      for (let i = 0; i < 10000; i++) {
        const t = i / 60;
        stepCharacterMotion(cs, co, "bot", t, 1 / 60, false); // no opts
        stepNodeOpen(ns, no, 1 / 60, false);
        stepFocusEase(fs, "bot", "bot", 1 / 60, false);
        stepSceneTransition(ss, so, 1 / 60, false);
        stepBreadcrumbEase(bs, bo, 1 / 60, false);
        sampleOrbitDrift(drift, base, t, 0.2, false); // no opts
      }
      assert.equal(created, 0, `Array allocs ${created}`);
    } finally {
      globalThis.Array = Orig;
    }
  });

  it("hardResetSharedMotionClockForTests actually resets; shared.reset stays no-op", () => {
    hardResetSharedMotionClockForTests();
    sharedMotionClock.map(100);
    assert.ok(sharedMotionClock.time > 0);
    sharedMotionClock.reset();
    assert.ok(sharedMotionClock.time > 0, "shared.reset must remain no-op");
    hardResetSharedMotionClockForTests();
    assert.equal(sharedMotionClock.time, 0);
    assert.equal(sharedMotionClock.anchorCount, 0);
  });
});
