import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOCUS_PULSE_SCALE,
  createFocusEaseState,
  stepFocusEase,
} from "./focus-ease.ts";
import { damp } from "./ease.ts";
import { sanitizeDt } from "./sanitize.ts";
import {
  NODE_OPEN_SCALE_FROM,
  beginSceneTransition,
  cancelSceneTransition,
  createNodeOpenSample,
  createNodeOpenState,
  createSceneTransitionSample,
  createSceneTransitionState,
  normalizeSceneId,
  setNodeOpen,
  stepNodeOpen,
  stepSceneTransition,
} from "./transition-ease.ts";

describe("transition-ease — node open/close", () => {
  it("opens from closed and settles at scale=1 opacity=1", () => {
    const st = createNodeOpenState(false);
    const out = createNodeOpenSample();
    setNodeOpen(st, true);
    for (let i = 0; i < 120; i++) stepNodeOpen(st, out, 1 / 60, false);
    assert.equal(out.done, true);
    assert.ok(Math.abs(out.scale - 1) < 1e-9);
    assert.ok(Math.abs(out.opacity - 1) < 1e-9);
    assert.equal(out.amount, 1);
  });

  it("closing halfway through opening resumes from current amount (no restart)", () => {
    const st = createNodeOpenState(false);
    const out = createNodeOpenSample();
    setNodeOpen(st, true);
    for (let i = 0; i < 8; i++) stepNodeOpen(st, out, 1 / 60, false);
    assert.ok(out.amount > 0.05 && out.amount < 0.95, `mid ${out.amount}`);
    const mid = out.amount;
    setNodeOpen(st, false); // reverse
    stepNodeOpen(st, out, 1 / 60, false);
    assert.ok(out.amount < mid, `should decrease from ${mid}, got ${out.amount}`);
    assert.ok(out.amount > mid - 0.2, `must not snap to 0 from ${mid}`);
  });

  it("reduced-motion snaps open/closed instantly", () => {
    const st = createNodeOpenState(false);
    const out = createNodeOpenSample();
    setNodeOpen(st, true);
    stepNodeOpen(st, out, 1 / 60, true);
    assert.equal(out.amount, 1);
    assert.equal(out.done, true);
    assert.equal(out.scale, 1);
    setNodeOpen(st, false);
    stepNodeOpen(st, out, 0, true);
    assert.equal(out.amount, 0);
    assert.ok(Math.abs(out.scale - NODE_OPEN_SCALE_FROM) < 1e-9);
  });

  it("dt edge cases stay finite (0 / negative / Infinity)", () => {
    const st = createNodeOpenState(false);
    const out = createNodeOpenSample();
    setNodeOpen(st, true);
    stepNodeOpen(st, out, 0, false);
    assert.equal(out.amount, 0);
    stepNodeOpen(st, out, -1, false);
    assert.equal(out.amount, 0);
    stepNodeOpen(st, out, Number.POSITIVE_INFINITY, false);
    assert.ok(out.amount > 0 && out.amount <= 1);
    assert.ok(Number.isFinite(out.scale) && Number.isFinite(out.opacity));
  });
});

describe("transition-ease — scene transition", () => {
  it("crossfade + dolly progress from universe to city", () => {
    const st = createSceneTransitionState();
    const out = createSceneTransitionSample();
    beginSceneTransition(st, "universe", "city");
    for (let i = 0; i < 200; i++) stepSceneTransition(st, out, 1 / 60, false);
    assert.equal(out.done, true);
    assert.equal(out.linear, 1);
    assert.equal(out.fadeIn, 1);
    assert.equal(out.fadeOut, 0);
    assert.equal(out.dolly, 1);
    assert.equal(out.fromId, "universe");
    assert.equal(out.toId, "city");
  });

  it("cancel mid-transition reverses from current progress", () => {
    const st = createSceneTransitionState();
    const out = createSceneTransitionSample();
    beginSceneTransition(st, "universe", "city");
    for (let i = 0; i < 10; i++) stepSceneTransition(st, out, 1 / 60, false);
    const mid = out.linear;
    assert.ok(mid > 0.05 && mid < 0.95);
    cancelSceneTransition(st);
    stepSceneTransition(st, out, 1 / 60, false);
    assert.ok(out.linear < mid);
    assert.ok(out.linear > mid - 0.2);
  });

  it("reversing corridor (city→universe) keeps complementary progress", () => {
    const st = createSceneTransitionState();
    const out = createSceneTransitionSample();
    beginSceneTransition(st, "universe", "city");
    for (let i = 0; i < 15; i++) stepSceneTransition(st, out, 1 / 60, false);
    const mid = out.linear;
    beginSceneTransition(st, "city", "universe"); // reverse pair
    assert.ok(Math.abs(st.progress - (1 - mid)) < 1e-9);
    assert.equal(st.fromId, "city");
    assert.equal(st.toId, "universe");
  });

  it("unknown / empty ids normalize to null; reduced-motion snaps", () => {
    assert.equal(normalizeSceneId(""), null);
    assert.equal(normalizeSceneId("  "), null);
    assert.equal(normalizeSceneId(null), null);
    assert.equal(normalizeSceneId(undefined), null);
    assert.equal(normalizeSceneId("interior"), "interior");
    const st = createSceneTransitionState();
    const out = createSceneTransitionSample();
    beginSceneTransition(st, "", "city");
    assert.equal(st.fromId, null);
    assert.equal(st.toId, "city");
    stepSceneTransition(st, out, 1 / 60, true);
    assert.equal(out.linear, 1);
    assert.equal(out.done, true);
  });

  it("dt Infinity advances one capped step (not freeze)", () => {
    const st = createSceneTransitionState();
    const out = createSceneTransitionSample();
    beginSceneTransition(st, "universe", "city");
    stepSceneTransition(st, out, Number.POSITIVE_INFINITY, false);
    assert.ok(out.linear > 0, `expected progress, got ${out.linear}`);
    assert.ok(Number.isFinite(out.dolly));
  });
});

describe("hacker c6 — Infinity dt + rapid focus + alloc-free batch", () => {
  it("sanitizeDt(+Infinity) matches huge finite cap (no damp freeze)", () => {
    assert.equal(sanitizeDt(Number.POSITIVE_INFINITY, 0.05), 0.05);
    assert.equal(sanitizeDt(Number.NEGATIVE_INFINITY, 0.05), 0);
    assert.equal(sanitizeDt(Number.NaN, 0.05), 0);
    const inf = damp(0, 10, 8, Number.POSITIVE_INFINITY);
    const huge = damp(0, 10, 8, 1e9);
    assert.equal(inf, huge);
    assert.ok(inf > 0);
  });

  it("rapidly toggling focusId every frame stays finite and bounded", () => {
    const st = createFocusEaseState();
    for (let i = 0; i < 5000; i++) {
      stepFocusEase(st, "bot:a", i % 2 === 0 ? "bot:a" : "bot:b", 1 / 60, false);
    }
    assert.ok(Number.isFinite(st.pulseMul) && Number.isFinite(st.driftMul));
    assert.ok(st.pulseMul >= 1 && st.pulseMul <= FOCUS_PULSE_SCALE + 1e-9);
    assert.ok(st.driftMul >= 0 && st.driftMul <= 1 + 1e-9);
  });

  it("thousands of stepFocusEase calls reuse state without throwing / NaN", () => {
    const N = 4000;
    const states = Array.from({ length: N }, () => createFocusEaseState());
    for (let f = 0; f < 30; f++) {
      for (let i = 0; i < N; i++) {
        stepFocusEase(states[i]!, `star:${i}`, f % 50 === i % 50 ? `star:${i}` : null, 1 / 60, false);
      }
    }
    for (let i = 0; i < N; i++) {
      assert.ok(Number.isFinite(states[i]!.pulseMul));
      assert.ok(Number.isFinite(states[i]!.driftMul));
    }
  });
});
