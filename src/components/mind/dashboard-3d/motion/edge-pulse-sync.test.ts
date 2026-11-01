import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createHoverTooltipSample,
  createHoverTooltipState,
  setHoverTooltipTarget,
  stepHoverTooltip,
  HOVER_INTENT_DELAY,
} from "./hover-tooltip-motion.ts";
import {
  createMotionPoseBag,
  parseMotionPoseBag,
  sanitizeMotionPoseBag,
  POSE_HOLD_MAX_IDS,
} from "./pose-hold.ts";
import { characterPhaseFromId, CHAR_PHASE_ID_MAX } from "./character-motion.ts";
import { createMotionClock } from "./motion-clock.ts";
import {
  createEdgePulseSample,
  createEdgePulseState,
  edgeTravelTowardTo,
  stepEdgePulseSync,
} from "./edge-pulse-sync.ts";

describe("hacker c11 — hover out-of-order / 1kHz / dual / leave-without-enter", () => {
  it("leave without enter stays hidden and finite", () => {
    const st = createHoverTooltipState();
    const out = createHoverTooltipSample();
    setHoverTooltipTarget(st, null);
    stepHoverTooltip(st, out, 1 / 60, false);
    assert.equal(st.hoverId, null);
    assert.equal(out.opacity, 0);
    assert.ok(Number.isFinite(out.edge));
  });

  it("1kHz enter/leave thrash does not commit hoverId", () => {
    const st = createHoverTooltipState();
    const out = createHoverTooltipSample();
    const dt = 0.001; // 1kHz
    for (let i = 0; i < 200; i++) {
      setHoverTooltipTarget(st, i % 2 === 0 ? "bot:a" : "bot:b");
      stepHoverTooltip(st, out, dt, false);
    }
    assert.equal(st.hoverId, null, "intent delay must block 1kHz thrash");
    assert.equal(out.opacity, 0);
  });

  it("two stars 'at once' — last pending wins; only one hoverId after dwell", () => {
    const st = createHoverTooltipState();
    const out = createHoverTooltipSample();
    setHoverTooltipTarget(st, "bot:a");
    setHoverTooltipTarget(st, "bot:b"); // simultaneous-ish
    let left = HOVER_INTENT_DELAY + 0.05;
    while (left > 0) {
      const slice = Math.min(1 / 60, left);
      stepHoverTooltip(st, out, slice, false);
      left -= slice;
    }
    assert.equal(st.hoverId, "bot:b");
    assert.notEqual(st.hoverId, "bot:a");
  });
});

describe("hacker c11 — 100k ids / phase hash / backwards wall", () => {
  it("pose-hold sanitize of 100k-key bag finishes fast and caps ids", () => {
    const focusById: Record<string, { pulseMul: number; driftMul: number }> = Object.create(null);
    for (let i = 0; i < 100_000; i++) {
      focusById["id:" + i] = { pulseMul: 1.1, driftMul: 0.5 };
    }
    // also plant dangerous keys
    (focusById as any).__proto__ = { pulseMul: 9, driftMul: 9 };
    const t0 = performance.now();
    const bag = sanitizeMotionPoseBag({
      version: 1,
      focusById,
      characterById: focusById,
      breadcrumb: null,
      nodeOpen: null,
      sceneTx: null,
    });
    const ms = performance.now() - t0;
    assert.ok(Object.keys(bag.focusById).length <= POSE_HOLD_MAX_IDS);
    assert.ok(Object.keys(bag.characterById).length <= POSE_HOLD_MAX_IDS);
    assert.ok(ms < 150, `sanitize 100k took ${ms}ms (expected for-in early break)`);
    assert.equal(({} as any).pulseMul, undefined);
  });

  it("characterPhaseFromId 100k long ids stays bounded and fast", () => {
    const long = "x".repeat(10_000);
    const t0 = performance.now();
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      sum += characterPhaseFromId(long + i);
    }
    const ms = performance.now() - t0;
    assert.ok(Number.isFinite(sum));
    assert.ok(ms < 500, `phase hash 100k took ${ms}ms`);
    // length cap must apply
    assert.ok(CHAR_PHASE_ID_MAX <= 256);
  });

  it("backwards wall times keep motion time monotonic and lastWallDt >= 0", () => {
    const clock = createMotionClock();
    const t0 = clock.map(1000);
    assert.ok(clock.lastWallDt >= 0);
    const t1 = clock.map(990); // backwards (worker clock skew)
    assert.ok(t1 >= t0);
    assert.ok(clock.lastWallDt >= 0, `after backwards lastWallDt=${clock.lastWallDt}`);
    const t2 = clock.map(980);
    assert.ok(t2 >= t1);
    assert.ok(clock.lastWallDt >= 0, `after 2nd backwards lastWallDt=${clock.lastWallDt}`);
    const t3 = clock.map(1001);
    assert.ok(t3 >= t2);
    assert.ok(clock.lastWallDt >= 0);
  });
});

describe("edge-pulse-sync", () => {
  it("reduced-motion is static highlight (travel mid, pulse 1)", () => {
    const st = createEdgePulseState();
    const out = createEdgePulseSample();
    const clock = createMotionClock();
    stepEdgePulseSync(st, out, 0.8, "a", "b", "b", 1, true, { clock });
    assert.equal(out.travel, 0.5);
    assert.equal(out.pulse, 1);
    assert.ok(Math.abs(out.highlight - 0.8) < 1e-9);
    assert.ok(out.neighborPulseMul < 1);
  });

  it("travel orients toward focusId endpoint", () => {
    assert.equal(edgeTravelTowardTo("a", "b", "b"), true);
    assert.equal(edgeTravelTowardTo("a", "b", "a"), false);
    assert.equal(edgeTravelTowardTo("a", "b", null), true);
  });

  it("phase-locks across samples with shared clock; strength 0 clears", () => {
    const st = createEdgePulseState();
    const out = createEdgePulseSample();
    const clock = createMotionClock();
    stepEdgePulseSync(st, out, 1, "a", "b", "b", 10, false, { clock });
    const h1 = out.highlight;
    const tr1 = out.travel;
    stepEdgePulseSync(st, out, 1, "a", "b", "b", 10, false, { clock }); // same wall → same map
    assert.equal(out.travel, tr1);
    assert.equal(out.highlight, h1);
    stepEdgePulseSync(st, out, 0, "a", "b", "b", 11, false, { clock });
    assert.equal(out.highlight, 0);
    assert.equal(out.neighborPulseMul, 1);
  });

  it("NaN strength / ids stay finite", () => {
    const st = createEdgePulseState();
    const out = createEdgePulseSample();
    stepEdgePulseSync(st, out, Number.NaN, null, undefined, "  ", Number.NaN, false);
    assert.ok(Number.isFinite(out.highlight));
    assert.ok(out.highlight >= 0 && out.highlight <= 1);
  });
});
