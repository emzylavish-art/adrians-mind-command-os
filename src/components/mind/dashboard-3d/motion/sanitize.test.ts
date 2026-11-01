import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampInt, finiteOr, finiteXyz, sanitizeDt, sanitizeTime } from "./sanitize.ts";

describe("sanitize (hacker pass)", () => {
  it("sanitizeDt caps tab-resume spikes and rejects NaN/negative", () => {
    assert.equal(sanitizeDt(Number.NaN), 0);
    assert.equal(sanitizeDt(-1), 0);
    assert.equal(sanitizeDt(5), 0.05);
    assert.equal(sanitizeDt(1 / 60), 1 / 60);
  });

  it("sanitizeTime rejects NaN and folds absurd absolute times", () => {
    assert.equal(sanitizeTime(Number.NaN), 0);
    assert.equal(sanitizeTime(Number.POSITIVE_INFINITY), 0);
    const folded = sanitizeTime(90000);
    assert.ok(Number.isFinite(folded));
    assert.ok(Math.abs(folded) < 86400);
  });

  it("finiteXyz collapses NaN positions to fallback", () => {
    const p = finiteXyz(Number.NaN, 1, Number.POSITIVE_INFINITY, { x: 9, y: 8, z: 7 });
    assert.deepEqual(p, { x: 9, y: 1, z: 7 });
  });

  it("clampInt bounds huge/negative/NaN counts", () => {
    assert.equal(clampInt(1e9, 0, 2048, 480), 2048);
    assert.equal(clampInt(-3, 0, 2048, 480), 0);
    assert.equal(clampInt(Number.NaN, 0, 2048, 480), 480);
  });

  it("finiteOr", () => {
    assert.equal(finiteOr(Number.NaN, 3), 3);
    assert.equal(finiteOr(2, 3), 2);
  });
});
