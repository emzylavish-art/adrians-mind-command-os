/**
 * Motion c35 — traveler trail focus-flip LOD snap.
 *
 * When `focused` flips mid-flight: force dirty resample to full, then hysteretic
 * thin restore on unfocus (no one-frame hole).
 *
 * HACKER (new vs c1–c34):
 *  - rapid focus flips across many travelers in one frame
 *  - focusing a traveler that was just disposed
 *  - focus while pointBudgetTotal is 0 (must park, never MIN-escape)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMotionClock } from "./motion-clock.ts";
import {
  TRAVELER_POINT_FAR,
  TRAVELER_POINT_MIN,
  allocateTravelerPointBudgets,
} from "./traveler-point-budget.ts";
import {
  createTravelerEaseSample,
  createTravelerEaseState,
} from "./traveler-ease.ts";
import {
  consumeTravelerPointsDirty,
  stepTravelerTrails,
  type TravelerTrail,
} from "./traveler-trails.ts";

function fat(n = 48) {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: Math.sin(i * 0.15), z: 0 }));
}

function makeTrail(n = 48): TravelerTrail {
  return {
    ease: createTravelerEaseState(),
    sample: createTravelerEaseSample(),
    points: fat(n),
    lastProgress: 0,
  };
}

describe("hacker c35 — focus while budget is 0", () => {
  it("allocateTravelerPointBudgets: focused under total=0 → 0 (no MIN escape)", () => {
    const wants = allocateTravelerPointBudgets(
      [{ pointCount: 48, focused: true }, { pointCount: 48, focused: false }],
      5,
      0,
    );
    assert.deepEqual(wants, [0, 0], `escaped ${wants}`);
  });

  it("stepTravelerTrails: focus + pointBudgetTotal 0 parks sample (no mid-path)", () => {
    const clock = createMotionClock();
    const tr = makeTrail();
    tr.focused = true;
    stepTravelerTrails([tr], 1, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: 5,
      pointBudgetTotal: 0,
    });
    assert.equal(tr.pointsBudget, 0);
    assert.ok(
      Math.abs(tr.sample.x) < 1e-6 && Math.abs(tr.sample.y) < 1e-6,
      `focus@0 escaped to path x=${tr.sample.x}`,
    );
  });
});

describe("hacker c35 — rapid focus flips across many travelers", () => {
  it("one frame: flip focus across 32 trails — newly focused full+dirty, others thin, samples finite", () => {
    const clock = createMotionClock();
    const trails = Array.from({ length: 32 }, () => makeTrail(40));
    // All thin far
    stepTravelerTrails(trails, 1, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: TRAVELER_POINT_FAR + 20,
    });
    for (const tr of trails) {
      assert.equal(tr.pointsBudget, TRAVELER_POINT_MIN);
      consumeTravelerPointsDirty(tr);
    }
    // Rapid flip: even indices focused
    for (let i = 0; i < trails.length; i++) trails[i]!.focused = i % 2 === 0;
    stepTravelerTrails(trails, 1.1, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: TRAVELER_POINT_FAR + 20,
    });
    for (let i = 0; i < trails.length; i++) {
      const tr = trails[i]!;
      if (i % 2 === 0) {
        assert.equal(tr.pointsBudget, 40, `focus[${i}] budget`);
        assert.equal(tr.pointsDirty, true, `focus[${i}] dirty`);
      } else {
        assert.equal(tr.pointsBudget, TRAVELER_POINT_MIN, `thin[${i}]`);
      }
      assert.ok(Number.isFinite(tr.sample.x) && Number.isFinite(tr.sample.y) && Number.isFinite(tr.sample.z));
    }
    // Flip again opposite
    for (let i = 0; i < trails.length; i++) trails[i]!.focused = i % 2 === 1;
    for (const tr of trails) consumeTravelerPointsDirty(tr);
    stepTravelerTrails(trails, 1.2, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: TRAVELER_POINT_FAR + 20,
    });
    for (let i = 0; i < trails.length; i++) {
      const tr = trails[i]!;
      if (i % 2 === 1) {
        assert.equal(tr.pointsBudget, 40);
        assert.equal(tr.pointsDirty, true);
      } else {
        assert.equal(tr.pointsBudget, TRAVELER_POINT_MIN);
      }
      assert.ok(Number.isFinite(tr.sample.x));
    }
  });
});

describe("hacker c35 — focus a just-disposed traveler", () => {
  it("disposed / null ease / cleared points + focused: no throw, skipped safely", () => {
    const clock = createMotionClock();
    const live = makeTrail();
    const deadEase = makeTrail();
    const deadPts = makeTrail();
    const deadFlag = makeTrail();
    stepTravelerTrails([live, deadEase, deadPts, deadFlag], 1, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: TRAVELER_POINT_FAR + 5,
    });
    // Dispose variants
    (deadEase as { ease: unknown }).ease = null;
    deadEase.focused = true;
    deadPts.points = [] as unknown as TravelerTrail["points"];
    deadPts.focused = true;
    deadFlag.disposed = true;
    deadFlag.focused = true;
    live.focused = true;
    assert.doesNotThrow(() => {
      stepTravelerTrails([live, deadEase, deadPts, deadFlag, null, undefined], 1.2, 1 / 60, false, {
        clock,
        enablePointBudget: true,
        camDistance: TRAVELER_POINT_FAR + 5,
      });
    });
    assert.equal(live.pointsBudget, 48);
    assert.equal(live.pointsDirty, true);
  });
});

describe("c35 — focus-flip LOD snap (no one-frame hole)", () => {
  it("unfocus→focus forces dirty full resample; unfocus restores thin", () => {
    const clock = createMotionClock();
    const tr = makeTrail(48);
    stepTravelerTrails([tr], 1, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: TRAVELER_POINT_FAR + 10,
    });
    assert.equal(tr.pointsBudget, TRAVELER_POINT_MIN);
    const r0 = tr.resampleCount ?? 0;
    consumeTravelerPointsDirty(tr);

    tr.focused = true;
    stepTravelerTrails([tr], 1.05, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: TRAVELER_POINT_FAR + 10,
    });
    assert.equal(tr.pointsBudget, 48);
    assert.ok((tr.resampleCount ?? 0) > r0);
    assert.equal(consumeTravelerPointsDirty(tr), true);
    // sample stays on path (not origin hole)
    assert.ok(Number.isFinite(tr.sample.x));

    tr.focused = false;
    stepTravelerTrails([tr], 1.1, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: TRAVELER_POINT_FAR + 10,
    });
    assert.equal(tr.pointsBudget, TRAVELER_POINT_MIN);
    assert.equal(tr.pointsDirty, true);
    assert.ok(Number.isFinite(tr.sample.x));
  });
});
