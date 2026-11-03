import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PERF_BOT_SOFT,
  evaluatePerfBudget,
  nextEmaFrameMs,
  sanitizeFrameMs,
} from "./perf-budget.ts";

describe("perf-budget (queue #17)", () => {
  it("sanitizes NaN/neg/Infinity frame samples", () => {
    assert.equal(sanitizeFrameMs(Number.NaN), 16.7);
    assert.equal(sanitizeFrameMs(-1), 16.7);
    assert.equal(sanitizeFrameMs(Number.POSITIVE_INFINITY), 16.7);
    assert.ok(nextEmaFrameMs(16, 40) > 16);
  });

  it("pauses labels only at soft cap + over budget; recovers under recover ms", () => {
    const hot = evaluatePerfBudget({ botCount: PERF_BOT_SOFT, emaFrameMs: 30, labelsPaused: false });
    assert.equal(hot.softCapHit, true);
    assert.equal(hot.labelsPaused, true);
    assert.ok(hot.hint && /paused/i.test(hot.hint));

    const cool = evaluatePerfBudget({ botCount: PERF_BOT_SOFT, emaFrameMs: 10, labelsPaused: true });
    assert.equal(cool.labelsPaused, false);

    const under = evaluatePerfBudget({ botCount: 5, emaFrameMs: 40, labelsPaused: false });
    assert.equal(under.labelsPaused, false);
    assert.equal(under.hint, null);
  });
});
