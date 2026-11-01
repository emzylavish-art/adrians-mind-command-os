import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOVER_FADE_DURATION,
  HOVER_INTENT_DELAY,
  HOVER_LIFT_PX,
  HOVER_SCALE_FROM,
  clearHoverTooltip,
  createHoverTooltipSample,
  createHoverTooltipState,
  setHoverTooltipTarget,
  stepHoverTooltip,
} from "./hover-tooltip-motion.ts";

function stepFrames(
  st: ReturnType<typeof createHoverTooltipState>,
  out: ReturnType<typeof createHoverTooltipSample>,
  seconds: number,
  reduced = false,
  dt = 1 / 60,
): void {
  let left = seconds;
  while (left > 1e-9) {
    const slice = Math.min(dt, left);
    stepHoverTooltip(st, out, slice, reduced);
    left -= slice;
  }
}

describe("hacker c10 — hover intent / edge jitter", () => {
  it("rapid star-edge crossings do not commit hoverId (no jitter)", () => {
    const st = createHoverTooltipState();
    const out = createHoverTooltipSample();
    const frame = HOVER_INTENT_DELAY / 3;
    setHoverTooltipTarget(st, "bot:a");
    stepHoverTooltip(st, out, frame, false);
    assert.equal(st.hoverId, null, "must not commit before intent delay");
    setHoverTooltipTarget(st, "bot:b");
    stepHoverTooltip(st, out, frame, false);
    assert.equal(st.hoverId, null);
    setHoverTooltipTarget(st, "bot:a");
    stepHoverTooltip(st, out, frame, false);
    assert.equal(st.hoverId, null);
    setHoverTooltipTarget(st, null);
    stepHoverTooltip(st, out, frame, false);
    assert.equal(st.hoverId, null);
    assert.equal(out.opacity, 0);
  });

  it("dwell past intent delay commits and eases in; leave eases out from mid", () => {
    const st = createHoverTooltipState();
    const out = createHoverTooltipSample();
    setHoverTooltipTarget(st, "bot:a");
    stepFrames(st, out, HOVER_INTENT_DELAY + 0.02);
    assert.equal(st.hoverId, "bot:a");
    assert.equal(st.target, 1);
    stepFrames(st, out, HOVER_FADE_DURATION * 0.35);
    assert.ok(st.amount > 0.05 && st.amount < 0.95);
    const mid = st.amount;
    setHoverTooltipTarget(st, null);
    stepFrames(st, out, HOVER_FADE_DURATION * 0.35);
    assert.ok(st.amount < mid);
    assert.ok(st.amount >= 0);
  });
});

describe("hover-tooltip-motion", () => {
  it("reduced-motion snaps show/hide (no intent wait on show after set+step)", () => {
    const st = createHoverTooltipState();
    const out = createHoverTooltipSample();
    setHoverTooltipTarget(st, "bot:x");
    stepHoverTooltip(st, out, 1 / 60, true);
    assert.equal(st.hoverId, "bot:x");
    assert.equal(out.opacity, 1);
    assert.equal(out.scale, 1);
    assert.equal(out.offsetY, 0);
    assert.equal(out.edge, 1);
    clearHoverTooltip(st);
    stepHoverTooltip(st, out, 1 / 60, true);
    assert.equal(out.opacity, 0);
    assert.equal(st.hoverId, null);
  });

  it("re-entering same id while exiting cancels hide", () => {
    const st = createHoverTooltipState();
    const out = createHoverTooltipSample();
    setHoverTooltipTarget(st, "bot:a");
    stepFrames(st, out, HOVER_INTENT_DELAY + HOVER_FADE_DURATION + 0.05);
    assert.ok(out.opacity > 0.9);
    setHoverTooltipTarget(st, null);
    stepFrames(st, out, HOVER_FADE_DURATION * 0.45);
    assert.ok(st.amount < 0.7);
    const mid = st.amount;
    setHoverTooltipTarget(st, "bot:a");
    stepHoverTooltip(st, out, 1 / 60, false);
    assert.equal(st.target, 1);
    stepFrames(st, out, HOVER_FADE_DURATION * 0.35);
    assert.ok(st.amount >= mid);
  });

  it("sample lift/scale bounds stay finite under NaN dt / empty id", () => {
    const st = createHoverTooltipState();
    const out = createHoverTooltipSample();
    setHoverTooltipTarget(st, "  ");
    stepHoverTooltip(st, out, Number.NaN, false);
    assert.equal(st.hoverId, null);
    setHoverTooltipTarget(st, "bot:a");
    stepHoverTooltip(st, out, Number.POSITIVE_INFINITY, false);
    assert.ok(Number.isFinite(out.opacity));
    assert.ok(Number.isFinite(out.offsetY));
    assert.ok(out.offsetY >= 0 && out.offsetY <= HOVER_LIFT_PX + 1e-6);
    assert.ok(out.scale >= HOVER_SCALE_FROM - 1e-6 && out.scale <= 1 + 1e-6);
  });

  it("frozen empty opts: stepping without opts object stays finite", () => {
    const st = createHoverTooltipState();
    const out = createHoverTooltipSample();
    setHoverTooltipTarget(st, "bot:a");
    for (let i = 0; i < 500; i++) stepHoverTooltip(st, out, 1 / 60, false);
    assert.ok(out.opacity >= 0 && out.opacity <= 1);
    assert.equal(st.hoverId, "bot:a");
  });
});
