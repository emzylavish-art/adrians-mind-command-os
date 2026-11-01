import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import { buildLockHealthShare } from "./chart-series.ts";
import { chartTickLabel } from "./chart-tick-label.ts";

const root = process.cwd();

describe("Gap#48 Time scrub sync", () => {
  it("scrubber exposes aria-valuetext; panels accept scrubNote; app rebuilds charts at scrub", () => {
    const scrub = readFileSync(join(root, "src/components/mind/dashboard-3d/time-scrubber.tsx"), "utf8");
    const app = readFileSync(join(root, "src/components/mind/dashboard-3d/dashboard-app.tsx"), "utf8");
    const charts = readFileSync(join(root, "src/components/mind/dashboard-3d/charts-panel.tsx"), "utf8");
    assert.match(scrub, /aria-valuetext=\{label\}/);
    assert.match(app, /buildDashboardCharts/);
    assert.match(app, /charts-scrub-note|scrubNote/);
    assert.match(charts, /scrubNote/);
    assert.match(app, /money-scrub-note|scrubNote=\{scrubPanelNote\}/);
  });
});

describe("Gap#49 chart labels + tooltips", () => {
  it("hour ticks survive ·c/r suffix; charts render role=tooltip text", () => {
    assert.equal(chartTickLabel("01/11 15h ·c5/r17", true), "15h");
    assert.equal(chartTickLabel("01/11 03h", false), "03h");
    const charts = readFileSync(join(root, "src/components/mind/dashboard-3d/charts-panel.tsx"), "utf8");
    assert.match(charts, /role="tooltip"/);
    assert.match(charts, /charts-lane-legend/);
  });
});

describe("Gap#50 lock claims vs releases", () => {
  it("zero-fills empty hours and pairs releases as altValue", () => {
    const now = Date.parse("2026-11-01T18:30:00+01:00");
    const tl = {
      events: [
        { atMs: Date.parse("2026-11-01T15:10:00+01:00"), atIso: "", kind: "lock_claim" as const, label: "c" },
        { atMs: Date.parse("2026-11-01T15:20:00+01:00"), atIso: "", kind: "lock_release" as const, label: "r" },
        { atMs: Date.parse("2026-11-01T17:05:00+01:00"), atIso: "", kind: "lock_claim" as const, label: "c2" },
      ],
      earliestMs: Date.parse("2026-11-01T15:10:00+01:00"),
      latestMs: now,
      truncated: false,
      droppedFuture: 0,
      droppedInvalid: 0,
    };
    const series = buildLockHealthShare(tl, now);
    assert.ok(series.points.length >= 3, "includes zero-filled hours");
    const withAlt = series.points.filter((p) => p.altValue != null);
    assert.equal(withAlt.length, series.points.length);
    const labels = series.points.map((p) => p.label);
    // 16h gap between 15 and 17 must appear as a zero bar
    assert.ok(labels.some((l) => /16h/.test(l)), labels.join("|"));
  });
});

describe("Gap#51 minimap vs charts", () => {
  it("raises charts above minimap height", () => {
    const css = readFileSync(join(root, "src/components/mind/dashboard-3d/dashboard-3d.css"), "utf8");
    assert.match(css, /Gap #51/);
    assert.match(css, /bottom:\s*calc\(0\.75rem \+ 158px\)/);
  });
});
