import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NO_SOURCE,
  buildBotDetailView,
  commitsForBranch,
  formatWat,
  lockHeartbeat,
  lockTask,
  notionNeighborIds,
  queueItemsForBot,
} from "./bot-detail.ts";
import type { BotNode, GitCommit, LockRecord } from "./types.ts";
import type { NotionGraph } from "./notion-graph-core.ts";

function bot(partial: Partial<BotNode> & { id: BotNode["id"] }): BotNode {
  return {
    name: partial.name ?? partial.id,
    health: "healthy",
    lock: null,
    branch: null,
    lastActivityAt: null,
    commits: [],
    notes: "",
    reason: "ok",
    ...partial,
  };
}

describe("bot-detail (real sources only)", () => {
  it("reads heartbeat/task from lock.raw and formats WAT", () => {
    const lock: LockRecord = {
      file: "logic-wiring.lock",
      owner: "Logic Bot",
      branch: "logic/foo",
      status: "claimed",
      claimed_at: "2026-11-01T12:00:00+01:00",
      released_at: null,
      commits: ["abc1234 note"],
      notes: "hi",
      worktree: "/workspace/x",
      raw: { heartbeat_at: "2026-11-01T12:05:00+01:00", task: '"wiring search"' },
    };
    assert.equal(lockHeartbeat(lock), "2026-11-01T12:05:00+01:00");
    assert.equal(lockTask(lock), "wiring search");
    assert.equal(lockHeartbeat(null), null);
    assert.match(formatWat("2026-11-01T12:00:00+01:00"), /WAT/);
    assert.equal(formatWat(null), NO_SOURCE);
    assert.equal(formatWat("not-a-date"), NO_SOURCE);
  });

  it("filters branch commits honestly and does not invent queue rows", () => {
    const commits: GitCommit[] = [
      { sha: "aaa", subject: "a", author: "x", date: "2026-11-01T10:00:00+01:00", branch: "dashboard-3d" },
      { sha: "bbb", subject: "b", author: "x", date: "2026-11-01T11:00:00+01:00", branch: "logic/foo" },
    ];
    assert.deepEqual(commitsForBranch(commits, "logic/foo").map((c) => c.sha), ["bbb"]);
    assert.deepEqual(commitsForBranch(commits, null), []);
    const b = bot({ id: "logic", name: "Logic Bot", branch: "logic/foo" });
    assert.equal(queueItemsForBot([], b, "Logic").length, 0);
    assert.equal(
      queueItemsForBot([{ index: 1, title: "Sound", status: "queued", detail: "WebAudio" }], b, "Logic").length,
      0,
    );
    assert.equal(
      queueItemsForBot([{ index: 2, title: "Logic wiring", status: "done", detail: "search" }], b, "Logic").length,
      1,
    );
  });

  it("buildBotDetailView fills no-source fields without fabricating", () => {
    const graph: NotionGraph = {
      available: true,
      mode: "snapshot",
      generatedAt: "t",
      pages: [{ id: "p1", title: "Logic handoff", url: "https://notion.so/p1", parentId: null, lastEdited: null, excerpt: "ex", kind: "page" }],
      edges: [{ from: "p1", to: "p2", kind: "child" }],
      botPageMap: { logic: "p1" },
      stats: { pages: 1, edges: 1, botsMapped: 1 },
    };
    const view = buildBotDetailView({
      bot: bot({ id: "logic", name: "Logic Bot", branch: null, lock: null, reason: "" }),
      bots: [bot({ id: "logic" }), bot({ id: "dashboard", name: "Dashboard Bot" })],
      commits: [],
      constellations: [{ id: "logic", name: "Logic", botIds: ["logic"], center: [0, 0, 0], health: "idle" }],
      constellationEdges: [{ from: "logic", to: "dashboard", kind: "hub", health: "idle" }],
      notionGraph: graph,
      fleetPlan: null,
    });
    assert.equal(view.laneName, "Logic");
    assert.equal(view.heartbeatAt, null);
    assert.equal(view.task, null);
    assert.equal(view.branchCommits.length, 0);
    assert.equal(view.notionPages[0]?.title, "Logic handoff");
    assert.equal(view.connections.some((c) => c.id === "dashboard"), true);
    assert.deepEqual(notionNeighborIds(graph, "p1"), ["p2"]);
  });
});
