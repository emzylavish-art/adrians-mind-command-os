import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Keep in sync with charts-panel.tsx CHART_VISIBLE_MAX. */
const CHART_VISIBLE_MAX = 28;

function finiteChartValue(n: unknown): number | null {
  if (typeof n === "string" && n.trim() !== "") n = Number(n);
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  if (n > 1e12) return 1e12;
  return n;
}

describe("Gap#62-64 chart harden (pure)", () => {
  it("drops NaN/null/negative and clamps huge", () => {
    assert.equal(finiteChartValue(Number.NaN), null);
    assert.equal(finiteChartValue(null), null);
    assert.equal(finiteChartValue(-50), null);
    assert.equal(finiteChartValue("NaN"), null);
    assert.equal(finiteChartValue(1e12), 1e12);
    assert.equal(finiteChartValue(1e13), 1e12);
    assert.equal(finiteChartValue(12.5), 12.5);
  });

  it("windows dense series to CHART_VISIBLE_MAX", () => {
    const cleaned = Array.from({ length: 120 }, (_, i) => finiteChartValue(i)).filter((v) => v != null) as number[];
    const visible = cleaned.length > CHART_VISIBLE_MAX ? cleaned.slice(-CHART_VISIBLE_MAX) : cleaned;
    assert.equal(visible.length, 28);
    assert.equal(visible[0], 92);
    assert.equal(visible.at(-1), 119);
  });
});
