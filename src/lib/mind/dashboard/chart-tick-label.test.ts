import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chartTickLabel } from "./chart-tick-label.ts";

describe("chartTickLabel (#38 Gap#15)", () => {
  it("uses hour suffix instead of truncating identical date stubs", () => {
    assert.equal(chartTickLabel("01/11 21h", true), "21h");
    assert.equal(chartTickLabel("01/11 09h", false), "09h");
  });
  it("uses bot initials instead of cosmos-… stubs", () => {
    const t = chartTickLabel("cosmos-painter", true);
    assert.ok(t.length <= 6);
    assert.notEqual(t, "cosmos-…");
    assert.match(t, /^c/);
  });
});
