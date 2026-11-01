import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GRADE_BY_TONE, colorGradeParamsForTone } from "./color-grade.ts";

describe("color-grade", () => {
  it("blocked grade has higher contrast and vignette than idle", () => {
    assert.ok(GRADE_BY_TONE.blocked.contrast > GRADE_BY_TONE.idle.contrast);
    assert.ok(GRADE_BY_TONE.blocked.vignette > GRADE_BY_TONE.idle.vignette);
  });

  it("healthy saturation is above stalled", () => {
    assert.ok(GRADE_BY_TONE.healthy.saturation > GRADE_BY_TONE.stalled.saturation);
  });

  it("colorGradeParamsForTone copies tint array", () => {
    const p = colorGradeParamsForTone("healthy");
    (p.tint as [number, number, number])[0] = 0;
    assert.notEqual(GRADE_BY_TONE.healthy.tint[0], 0);
  });
});
