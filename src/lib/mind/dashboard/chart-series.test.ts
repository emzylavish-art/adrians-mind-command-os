import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NO_CHART_SOURCE,
  buildCommitsPerBotHour,
  buildDashboardCharts,
  buildLandingsPerLane,
  buildLockHealthShare,
  buildSpendSeries,
} from "./chart-series.ts";
import { buildTimeline } from "./time-scrub.ts";
import type { GitCommit } from "./types.ts";

const NOW = Date.parse("2026-11-01T18:00:00+01:00");

describe("chart-series (real data + hacker)", () => {
  it("empty inputs → no source yet, no invented points", () => {
    const charts = buildDashboardCharts({ nowMs: NOW });
    assert.equal(charts.commitsPerBotHour.emptyReason, NO_CHART_SOURCE);
    assert.equal(charts.commitsPerBotHour.points.length, 0);
    assert.equal(charts.spend.emptyReason, NO_CHART_SOURCE);
    assert.equal(charts.landingsPerLane.points.length, 0);
  });

  it("maps commits to bots; drops NaN-dated; caps", () => {
    const commits: GitCommit[] = [
      { sha: "a", subject: "x", author: "b", date: "2026-11-01T17:10:00+01:00", branch: "dashboard-3d" },
      { sha: "b", subject: "y", author: "b", date: "2026-11-01T17:20:00+01:00", branch: "dashboard-3d-visual-light" },
      { sha: "c", subject: "z", author: "b", date: "not-a-date", branch: "dashboard-3d" },
      { sha: "d", subject: "old", author: "b", date: "2026-10-01T12:00:00+01:00", branch: "dashboard-3d" },
    ];
    const s = buildCommitsPerBotHour(commits, NOW, 12);
    assert.ok(s.points.some((p) => p.label === "dashboard" && p.value === 1));
    assert.ok(s.points.some((p) => p.label === "cosmos-light" && p.value === 1));
    assert.ok(!s.points.some((p) => p.value !== p.value)); // no NaN
  });

  it("lock timeline buckets claims; landings count reached hops", () => {
    const tl = buildTimeline({
      nowMs: NOW,
      locks: [
        {
          file: "dashboard-3d.lock",
          owner: "Dashboard Bot",
          branch: "dashboard-3d",
          status: "claimed",
          claimed_at: "2026-11-01T17:00:00+01:00",
          released_at: "2026-11-01T17:30:00+01:00",
          commits: [],
          notes: "",
          worktree: null,
          raw: {},
        },
      ],
    });
    const lock = buildLockHealthShare(tl, NOW);
    assert.ok(lock.points.length >= 1);
    const land = buildLandingsPerLane([
      {
        lane: "light",
        botId: "cosmos-light",
        branch: "dashboard-3d-visual-light",
        remoteOk: true,
        remoteUrl: "x",
        expectedRemoteIncludes: "x",
        tipSha: "abc",
        hops: [
          { hop: "fleet-branch", ref: "a", sha: "abc", reached: true, note: "" },
          { hop: "dashboard-3d", ref: "b", sha: null, reached: false, note: "" },
          { hop: "preview/integration", ref: "c", sha: null, reached: false, note: "" },
          { hop: "main", ref: "d", sha: null, reached: false, note: "" },
        ],
        mergedIntoDashboard3d: false,
        mergedIntoPreviewIntegration: false,
        mergedIntoMain: false,
        mergeGate: { watching: true, note: "" },
      },
    ]);
    assert.equal(land.points[0]?.value, 1);
    const spend = buildSpendSeries({
      available: false,
      reason: "no spend source yet",
      source: null,
      currency: "USD",
      todayTotalUsd: null,
      burnPerHourUsd: null,
      warnings: [],
      asOfMs: null,
      eventCount: 0,
      stale: false,
      droppedInvalid: 0,
      todayKey: null,
    });
    assert.equal(spend.points.length, 0);
  });
});
