import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import { adjustBurnForHiddenGap } from "./spend-core.ts";
import { lockHistoryFromTimeline, buildBotDetailView } from "./bot-detail.ts";
import type { Timeline } from "./time-scrub.ts";
import type { BotNode } from "./types.ts";

const root = process.cwd();

describe("Gap#34 money burn vs hidden tab", () => {
  it("nulls burn and warns after long hide; short gaps keep burn", () => {
    const base = {
      available: true as const,
      reason: null,
      source: "test",
      currency: "USD" as const,
      todayTotalUsd: 1,
      burnPerHourUsd: 12.5,
      warnings: [] as { level: "warn" | "crit"; message: string; thresholdUsd: number; observedUsd: number }[],
      asOfMs: 1,
      eventCount: 1,
      stale: false,
      droppedInvalid: 0,
      todayKey: "2026-11-01",
    };
    assert.equal(adjustBurnForHiddenGap(base, 60_000).burnPerHourUsd, 12.5);
    const long = adjustBurnForHiddenGap(base, 40 * 60_000);
    assert.equal(long.burnPerHourUsd, null);
    assert.ok(long.warnings.some((w) => /Gap#34|hidden/i.test(w.message)));
  });

  it("status hook records hiddenGapMs and clears after resume window", () => {
    const src = readFileSync(join(root, "src/components/mind/dashboard-3d/use-dashboard-status.ts"), "utf8");
    assert.match(src, /setHiddenGapMs\(Date\.now\(\) - hiddenSinceRef/);
    assert.match(src, /setHiddenGapMs\(0\)/);
    assert.match(src, /Gap#34/);
    const app = readFileSync(join(root, "src/components/mind/dashboard-3d/dashboard-app.tsx"), "utf8");
    assert.match(app, /adjustBurnForHiddenGap/);
  });
});

describe("c49 surfaces — lock history + portraits", () => {
  it("builds lock history from timeline for a bot", () => {
    const tl = {
      events: [
        { atMs: 1, atIso: "2026-11-01T10:00:00+01:00", kind: "lock_claim" as const, botId: "logic" as const, label: "claimed", lockFile: "logic.lock" },
        { atMs: 2, atIso: "2026-11-01T10:05:00+01:00", kind: "lock_release" as const, botId: "logic" as const, label: "released" },
        { atMs: 3, atIso: "2026-11-01T10:06:00+01:00", kind: "commit" as const, botId: "logic" as const, label: "c" },
      ],
      earliestMs: 1,
      latestMs: 3,
      droppedFuture: 0,
      droppedInvalid: 0,
      truncated: false,
    } as Timeline;
    const rows = lockHistoryFromTimeline(tl, "logic");
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.kind, "lock_release");
  });

  it("lists Imagine portraits missing for fleet bots", () => {
    const bots = [
      "grok-build","conductor","gap-dispatcher","rea-feature-hunter","merge-gate","visual-polish","logic",
      "mcp-integration","media-integration","voice-integration","voice-wiring","error-banners","xai-verification",
      "hp-pairing","dashboard","cosmos-painter","cosmos-light","cosmos-motion",
    ];
    const dir = join(root, "public/dashboard-3d/art");
    const files = new Set(readdirSync(dir).filter((f) => f.startsWith("portrait-") && f.endsWith(".webp")));
    const missing = bots.filter((id) => !files.has(`portrait-${id}.webp`));
    assert.deepEqual(missing, [], `missing portraits: ${missing.join(",")}`);
  });
});

describe("c49 chart drilldown + detail lock history wiring", () => {
  it("charts-panel and node-detail expose drilldown / lock history", () => {
    const charts = readFileSync(join(root, "src/components/mind/dashboard-3d/charts-panel.tsx"), "utf8");
    const detail = readFileSync(join(root, "src/components/mind/dashboard-3d/node-detail-panel.tsx"), "utf8");
    const app = readFileSync(join(root, "src/components/mind/dashboard-3d/dashboard-app.tsx"), "utf8");
    assert.match(charts, /onSelectBotId/);
    assert.match(charts, /onScrubRatio/);
    assert.match(detail, /detail-lock-history/);
    assert.match(detail, /lockHistory/);
    assert.match(app, /onSelectBotId=\{/);
  });
});
