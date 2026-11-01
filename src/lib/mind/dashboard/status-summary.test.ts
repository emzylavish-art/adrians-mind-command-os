import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { botDetailFromStatus, slimDashboardStatusForPoll } from "./status-summary.ts";

describe("status-summary Gap#59", () => {
  it("strips notion excerpts, caps timeline/commits/queue, keeps bot ids", () => {
    const fat = {
      bots: [
        {
          id: "logic",
          name: "Logic",
          health: "healthy",
          notes: "n".repeat(400),
          commits: ["a", "b", "c", "d", "e"],
          lock: {
            file: "x.lock",
            notes: "n".repeat(400),
            commits: ["a", "b", "c", "d", "e"],
            heartbeatAt: "t",
            task: "t",
          },
          branch: "dashboard-3d",
          reason: "ok",
        },
      ],
      commits: Array.from({ length: 40 }, (_, i) => ({ sha: `s${i}`, subject: `c${i}`, branch: "dashboard-3d" })),
      notionGraph: {
        available: true,
        pages: [{ id: "p1", title: "Logic", excerpt: "LONG ".repeat(80), url: "u" }],
        edges: [{ from: "p1", to: "p2", kind: "child" }],
        botPageMap: { logic: "p1" },
        stats: { pages: 1, edges: 1, botsMapped: 1 },
      },
      timeline: {
        events: Array.from({ length: 80 }, (_, i) => ({ atMs: i, atIso: `t${i}`, kind: "commit", label: `e${i}` })),
        earliestMs: 0,
        latestMs: 79,
        truncated: false,
      },
      skyFeed: { events: Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, label: `f${i}` })) },
      fleetPlan: {
        queue: Array.from({ length: 30 }, (_, i) => ({ index: i, title: `q${i}`, status: "queued", detail: "d".repeat(200) })),
      },
    };
    const slim = slimDashboardStatusForPoll(fat as Record<string, unknown>);
    assert.equal(slim.summary.mode, "summary");
    const view = slim as unknown as {
      notionGraph: { pages: { excerpt: string }[] };
      timeline: { events: unknown[] };
      commits: unknown[];
      fleetPlan: { queue: unknown[] };
      bots: { id: string }[];
    };
    assert.equal(view.notionGraph.pages[0]!.excerpt, "");
    assert.ok((view.timeline?.events.length ?? 0) <= 48);
    assert.ok(view.commits.length <= 24);
    assert.ok((view.fleetPlan?.queue.length ?? 0) <= 16);
    assert.equal(view.bots[0]!.id, "logic");
    assert.ok(JSON.stringify(slim).length < JSON.stringify(fat).length);
  });

  it("botDetailFromStatus returns mapped notion page without inventing bots", () => {
    const s = {
      bots: [{ id: "logic", name: "Logic", health: "healthy", lock: null, branch: "dashboard-3d", notes: "", commits: [], reason: "", lastActivityAt: null }],
      commits: [],
      notionGraph: {
        available: true,
        pages: [{ id: "p1", title: "Logic handoff", excerpt: "ex", url: "u" }],
        edges: [],
        botPageMap: { logic: "p1" },
        stats: { pages: 1, edges: 0, botsMapped: 1 },
      },
    };
    const miss = botDetailFromStatus(s as never, "nope");
    assert.equal(miss.ok, false);
    const hit = botDetailFromStatus(s as never, "logic");
    assert.equal(hit.ok, true);
    if (hit.ok) {
      assert.equal(hit.bot.id, "logic");
      assert.equal(hit.notionPages[0]?.id, "p1");
    }
  });
});
