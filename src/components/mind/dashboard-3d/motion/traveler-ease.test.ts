import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  createEdgePulseSample,
  createEdgePulseState,
  stepEdgePulseSync,
} from "./edge-pulse-sync.ts";
import {
  createFocusEaseState,
  stepFocusEase,
} from "./focus-ease.ts";
import {
  createHoverTooltipSample,
  createHoverTooltipState,
  setHoverTooltipTarget,
  stepHoverTooltip,
} from "./hover-tooltip-motion.ts";
import {
  createBreadcrumbEaseSample,
  createBreadcrumbEaseState,
  setBreadcrumbFocus,
  stepBreadcrumbEase,
} from "./breadcrumb-ease.ts";
import {
  createNodeOpenSample,
  createNodeOpenState,
  createSceneTransitionSample,
  createSceneTransitionState,
  setNodeOpen,
  beginSceneTransition,
  stepNodeOpen,
  stepSceneTransition,
} from "./transition-ease.ts";
import {
  createCharacterMotionState,
  createCharacterSample,
  stepCharacterMotion,
} from "./character-motion.ts";
import {
  createMotionClock,
  hardResetSharedMotionClockForTests,
} from "./motion-clock.ts";
import {
  createTravelerEaseSample,
  createTravelerEaseState,
  pauseTraveler,
  resumeTraveler,
  sampleTravelerPolyline,
  stepTravelerEase,
  TRAVELER_DURATION,
} from "./traveler-ease.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("hacker c12 — edge-pulse degenerate edges + focus flicker", () => {
  it("self-loop / zero-length / null endpoints stay finite with static travel", () => {
    const st = createEdgePulseState();
    const out = createEdgePulseSample();
    const clock = createMotionClock();
    stepEdgePulseSync(st, out, 1, "a", "a", "a", 5, false, { clock });
    assert.ok(Number.isFinite(out.travel));
    assert.ok(Number.isFinite(out.highlight));
    assert.equal(out.travel, 0.5, "self-loop must park travel at mid");
    stepEdgePulseSync(st, out, 0.7, null, "", "  ", 6, false, { clock });
    assert.ok(Number.isFinite(out.highlight));
    assert.equal(out.travel, 0.5);
  });

  it("focus id changing every frame keeps highlight finite (no NaN thrash)", () => {
    const st = createEdgePulseState();
    const out = createEdgePulseSample();
    const clock = createMotionClock();
    for (let i = 0; i < 500; i++) {
      const focus = i % 2 === 0 ? "a" : "b";
      stepEdgePulseSync(st, out, 1, "a", "b", focus, 10 + i / 60, false, { clock });
      assert.ok(Number.isFinite(out.travel), `travel NaN at i=${i}`);
      assert.ok(Number.isFinite(out.highlight));
      assert.ok(out.travel >= 0 && out.travel <= 1);
    }
  });
});

describe("hacker c12 — step* determinism + no side-effect imports", () => {
  it("each step* is deterministic with private clocks / fresh state", () => {
    hardResetSharedMotionClockForTests();
    const clock = createMotionClock();

    // focus
    const f1 = createFocusEaseState();
    const f2 = createFocusEaseState();
    stepFocusEase(f1, "a", "a", 1 / 60, false);
    stepFocusEase(f2, "a", "a", 1 / 60, false);
    assert.equal(f1.pulseMul, f2.pulseMul);
    assert.equal(f1.driftMul, f2.driftMul);

    // character
    const c1 = createCharacterMotionState();
    const c2 = createCharacterMotionState();
    const co1 = createCharacterSample();
    const co2 = createCharacterSample();
    stepCharacterMotion(c1, co1, "bot:a", 3, 1 / 60, false, { clock, speed: 1 });
    stepCharacterMotion(c2, co2, "bot:a", 3, 1 / 60, false, { clock, speed: 1 });
    assert.equal(co1.offsetY, co2.offsetY);
    assert.equal(co1.loco, co2.loco);

    // edge
    const e1 = createEdgePulseState();
    const e2 = createEdgePulseState();
    const eo1 = createEdgePulseSample();
    const eo2 = createEdgePulseSample();
    stepEdgePulseSync(e1, eo1, 1, "a", "b", "b", 4, false, { clock });
    stepEdgePulseSync(e2, eo2, 1, "a", "b", "b", 4, false, { clock });
    assert.equal(eo1.travel, eo2.travel);
    assert.equal(eo1.highlight, eo2.highlight);

    // hover
    const h1 = createHoverTooltipState();
    const h2 = createHoverTooltipState();
    const ho1 = createHoverTooltipSample();
    const ho2 = createHoverTooltipSample();
    setHoverTooltipTarget(h1, "x");
    setHoverTooltipTarget(h2, "x");
    for (let i = 0; i < 20; i++) {
      stepHoverTooltip(h1, ho1, 1 / 60, false);
      stepHoverTooltip(h2, ho2, 1 / 60, false);
    }
    assert.equal(ho1.opacity, ho2.opacity);
    assert.equal(h1.hoverId, h2.hoverId);

    // breadcrumb
    const b1 = createBreadcrumbEaseState();
    const b2 = createBreadcrumbEaseState();
    const bo1 = createBreadcrumbEaseSample();
    const bo2 = createBreadcrumbEaseSample();
    setBreadcrumbFocus(b1, "z");
    setBreadcrumbFocus(b2, "z");
    stepBreadcrumbEase(b1, bo1, 0.1, false);
    stepBreadcrumbEase(b2, bo2, 0.1, false);
    assert.equal(bo1.opacity, bo2.opacity);

    // node + scene
    const n1 = createNodeOpenState(false);
    const n2 = createNodeOpenState(false);
    setNodeOpen(n1, true);
    setNodeOpen(n2, true);
    const no1 = createNodeOpenSample();
    const no2 = createNodeOpenSample();
    stepNodeOpen(n1, no1, 0.1, false);
    stepNodeOpen(n2, no2, 0.1, false);
    assert.equal(no1.amount, no2.amount);

    const s1 = createSceneTransitionState();
    const s2 = createSceneTransitionState();
    beginSceneTransition(s1, "universe", "city");
    beginSceneTransition(s2, "universe", "city");
    const so1 = createSceneTransitionSample();
    const so2 = createSceneTransitionSample();
    stepSceneTransition(s1, so1, 0.1, false);
    stepSceneTransition(s2, so2, 0.1, false);
    assert.equal(so1.eased, so2.eased);

    // traveler
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ];
    const t1 = createTravelerEaseState(0.2);
    const t2 = createTravelerEaseState(0.2);
    const to1 = createTravelerEaseSample();
    const to2 = createTravelerEaseSample();
    stepTravelerEase(t1, to1, pts, 8, 1 / 60, false, { clock });
    stepTravelerEase(t2, to2, pts, 8, 1 / 60, false, { clock });
    assert.equal(to1.x, to2.x);
    assert.equal(to1.progress, to2.progress);
  });

  it("motion/ sources: no eager shared-clock side effect; leaf modules stay pure", () => {
    const clockSrc = readFileSync(join(HERE, "motion-clock.ts"), "utf8");
    // Must NOT eagerly construct the singleton at module evaluate time.
    assert.equal(
      /const _sharedMotionClockInner:\s*MotionClock\s*=\s*createMotionClock\(\)/.test(clockSrc),
      false,
      "shared clock must be lazy (tree-shaking / no import side effect)",
    );
    // Leaf pure modules must not import motion-clock
    for (const leaf of ["ease.ts", "sanitize.ts", "reduced-motion.ts"]) {
      const src = readFileSync(join(HERE, leaf), "utf8");
      assert.equal(
        /from\s+["']\.\/motion-clock/.test(src),
        false,
        `${leaf} must not import motion-clock`,
      );
    }
    // No motion module may import DOM-only side-effectful listeners at top level
    for (const name of readdirSync(HERE)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const src = readFileSync(join(HERE, name), "utf8");
      assert.equal(
        /^addEventListener\(/m.test(src) || /document\.addEventListener/.test(src),
        false,
        `${name} must not register document listeners at import`,
      );
    }
  });
});

describe("traveler-ease", () => {
  const path = [
    { x: 0, y: 1, z: 0 },
    { x: 4, y: 1, z: 0 },
    { x: 4, y: 1, z: 4 },
  ];

  it("reduced-motion snaps to static seed pose", () => {
    const st = createTravelerEaseState(0.25);
    const out = createTravelerEaseSample();
    const clock = createMotionClock();
    stepTravelerEase(st, out, path, 100, 1 / 60, true, { clock });
    assert.ok(Math.abs(st.progress - 0.25) < 1e-9);
    const expected = { x: 0, y: 0, z: 0 };
    sampleTravelerPolyline(expected, path, 0.25);
    assert.ok(Math.abs(out.x - expected.x) < 1e-9);
    assert.equal(out.done, true);
  });

  it("pause freezes progress; resume continues via MotionClock (no teleport)", () => {
    const st = createTravelerEaseState(0);
    const out = createTravelerEaseSample();
    const clock = createMotionClock();
    stepTravelerEase(st, out, path, 0, 1 / 60, false, { clock, duration: 10 });
    stepTravelerEase(st, out, path, 2, 1 / 60, false, { clock, duration: 10 });
    const mid = st.progress;
    pauseTraveler(st);
    stepTravelerEase(st, out, path, 20, 1 / 60, false, { clock, duration: 10 });
    assert.equal(st.progress, mid);
    assert.ok(out.opacity < 0.95);
    resumeTraveler(st);
    stepTravelerEase(st, out, path, 20, 1 / 60, false, { clock, duration: 10 });
    // progress follows clock at t=20, not a jump from wall gap alone
    assert.ok(Number.isFinite(st.progress));
    assert.ok(st.progress >= 0 && st.progress < 1);
  });

  it("empty / single-point / NaN progress stay finite", () => {
    const st = createTravelerEaseState(Number.NaN);
    const out = createTravelerEaseSample();
    stepTravelerEase(st, out, [], Number.NaN, Number.POSITIVE_INFINITY, false);
    assert.ok(Number.isFinite(out.x));
    stepTravelerEase(st, out, [{ x: 1, y: 2, z: 3 }], 1, 1 / 60, false);
    assert.equal(out.x, 1);
    assert.equal(out.y, 2);
  });

  it("tab-resume-sized wall gap does not explode traveler via clock map", () => {
    const st = createTravelerEaseState(0);
    const out = createTravelerEaseSample();
    const clock = createMotionClock();
    stepTravelerEase(st, out, path, 1, 1 / 60, false, { clock });
    const p0 = st.progress;
    stepTravelerEase(st, out, path, 1 + 3600, 1 / 60, false, { clock }); // 1h hidden
    // MotionClock collapses resume → nominal step; progress must stay in [0,1)
    assert.ok(st.progress >= 0 && st.progress < 1);
    assert.ok(Number.isFinite(out.x));
    assert.ok(Math.abs(st.progress - p0) < 0.5, "must not leap half a lap on resume");
  });
});
