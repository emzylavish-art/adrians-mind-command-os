import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProjectsDashboard } from "./projects.ts";
import type { DashboardStatus } from "./types.ts";

function baseStatus(partial: Partial<DashboardStatus> = {}): DashboardStatus {
  return {
    generatedAt: "2026-11-01T12:00:00+01:00",
    bots: [
      {
        id: "logic",
        name: "Logic Bot",
        health: "healthy",
        lock: {
          file: "logic-wiring.lock",
          owner: "Logic Bot",
          branch: "logic-wiring",
          status: "done, released",
          claimed_at: "2026-11-01T12:00:00+01:00",
          released_at: "2026-11-01T12:10:00+01:00",
          commits: ["abc1234"],
          notes: "ok",
          worktree: null,
          raw: {},
        },
        branch: "logic-wiring",
        lastActivityAt: "2026-11-01T12:10:00+01:00",
        commits: ["abc1234"],
        notes: "ok",
        reason: "done",
      },
    ],
    commits: [],
    notion: { available: false, reason: "none" },
    conductor: { source: "unavailable", nudges: [] },
    gapDispatcher: {
      source: "/tmp/gaps.json",
      items: [
        { rank: 1, feature: "Web search", status: "open" },
        { rank: 2, feature: "Done thing", status: "closed" },
      ],
    },
    orchestrator: {
      owner: "Grok Build",
      status: "claimed",
      branch: "preview/integration",
      claimed_at: "2026-11-01T12:00:00+01:00",
      notes: "checking",
      lockFile: "integration.lock",
    },
    spend: { available: false, reason: "none" },
    sources: { locksDir: "/workspace/locks", repoDir: "/workspace/mind-command-os", locksOk: true, gitOk: true },
    constellations: [],
    constellationEdges: [],
    weather: { label: "Clear skies", tone: "healthy", summary: "1 healthy" },
    notionGraph: {
      available: false,
      mode: "unavailable",
      generatedAt: null,
      pages: [],
      edges: [],
      botPageMap: {},
      stats: { pages: 0, edges: 0, botsMapped: 0 },
    },
    projects: { available: true, projects: [], agents: [], generatedAt: "2026-11-01T12:00:00+01:00" },
    fleetPlan: {
      fleetStars: [],
      landings: [],
      queue: [],
      queueHead: null,
      mergeGateNote: "",
    },
    timeline: {
      events: [],
      earliestMs: null,
      latestMs: null,
      droppedFuture: 0,
      droppedInvalid: 0,
      truncated: false,
    },
    skyFeed: {
      events: [],
      list: [],
      sources: {
        conductor: "no source yet",
        gap: "no source yet",
        lock: "no source yet",
        landing: "no source yet",
        commit: "no source yet",
        merge_gate: "no source yet",
        notion_stop: "no source yet",
      },
      droppedFlood: 0,
      droppedStale: 0,
      droppedDupes: 0,
      generatedAtMs: 0,
    },
    money: {
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
    },
    charts: {
      commitsPerBotHour: { id: "commits-per-bot", title: "Commits", unit: "commits", points: [], source: "no source yet", emptyReason: "no source yet" },
      lockHealthShare: { id: "lock-health-share", title: "Locks", unit: "claims", points: [], source: "no source yet", emptyReason: "no source yet" },
      landingsPerLane: { id: "landings-per-lane", title: "Landings", unit: "hops", points: [], source: "no source yet", emptyReason: "no source yet" },
      spend: { id: "spend", title: "Spend", unit: "USD", points: [], source: "no source yet", emptyReason: "no source yet" },
      generatedAtMs: 0,
    },
    notionMirror: {
      available: false,
      reason: "no source yet",
      mode: "unavailable",
      generatedAt: null,
      rows: [],
      staleCount: 0,
      mappedCount: 0,
    },
    ...partial,
  };
}

describe("projects dashboard", () => {
  it("builds gap project progress from real open/done counts", () => {
    const dash = buildProjectsDashboard(baseStatus());
    const gap = dash.projects.find((p) => p.id === "project-gap-cycle");
    assert.ok(gap);
    assert.equal(gap!.openTasks, 1);
    assert.equal(gap!.doneTasks, 1);
    assert.equal(gap!.progress, 0.5);
  });

  it("returns honest empty when gap source unavailable", () => {
    const dash = buildProjectsDashboard(
      baseStatus({ gapDispatcher: { source: "unavailable", items: [] } }),
    );
    const gap = dash.projects.find((p) => p.id === "project-gap-cycle");
    assert.ok(gap?.emptyReason);
    assert.equal(gap!.tasks.length, 0);
  });

  it("exposes agent stats from bots without inventing failures", () => {
    const dash = buildProjectsDashboard(baseStatus());
    const agent = dash.agents.find((a) => a.botId === "logic");
    assert.ok(agent);
    assert.equal(agent!.failure, 0);
    assert.ok(agent!.runs >= 1);
  });
});

describe("projects honesty (hacker pass c8)", () => {
  it("does not fabricate bot progress or run results/timestamps", () => {
    const status = baseStatus();
    const claimed = {
      ...status.bots[0]!,
      id: "mcp-integration" as const,
      name: "MCP Bot",
      health: "healthy" as const,
      lock: { ...status.bots[0]!.lock!, status: "claimed", released_at: null },
    };
    const dash = buildProjectsDashboard({ ...status, bots: [status.bots[0]!, claimed] });
    const b = dash.projects.find((p) => p.id === "bot-mcp-integration")!;
    assert.equal(b.progressKnown, false);
    assert.equal(b.progress, 0);
    const done = dash.projects.find((p) => p.id === "bot-logic")!;
    assert.equal(done.progressKnown, true);
    assert.equal(done.progress, 1);
    assert.ok(done.recentRuns.every((r) => r.ok === null && r.at === null));
  });
});
