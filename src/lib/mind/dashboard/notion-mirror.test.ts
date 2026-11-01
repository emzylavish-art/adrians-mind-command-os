import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_MIRROR_SOURCE, buildNotionMirrorView, freshnessLabel } from "./notion-mirror.ts";
import type { BotNode } from "./types.ts";
import type { NotionGraph } from "./notion-graph-core.ts";

const NOW = Date.parse("2026-11-01T18:00:00+01:00");

function bot(id: string, name: string): BotNode {
  return {
    id: id as BotNode["id"],
    name,
    health: "idle",
    lock: null,
    branch: null,
    lastActivityAt: null,
    commits: [],
    notes: "",
    reason: "",
  };
}

describe("notion-mirror (queue #9)", () => {
  it("unavailable graph → no source yet", () => {
    const v = buildNotionMirrorView({
      bots: [bot("dashboard", "Dashboard Bot")],
      graph: { available: false, mode: "unavailable", generatedAt: null, pages: [], edges: [], botPageMap: {}, stats: { pages: 0, edges: 0, botsMapped: 0 } },
      nowMs: NOW,
    });
    assert.equal(v.available, false);
    assert.ok((v.reason || "").includes("source") || v.reason === NO_MIRROR_SOURCE || v.rows.length === 0);
  });

  it("marks stale vs fresh from lastEdited; sanitizes titles", () => {
    const graph: NotionGraph = {
      available: true,
      mode: "snapshot",
      generatedAt: "t",
      pages: [
        {
          id: "p1",
          title: "<b>Dashboard stop-point</b>",
          url: "https://notion.so/p1",
          parentId: null,
          lastEdited: "2026-11-01T17:50:00+01:00",
          excerpt: "landed charts",
          kind: "page",
        },
        {
          id: "p2",
          title: "Logic handoff",
          url: "https://notion.so/p2",
          parentId: null,
          lastEdited: "2026-10-01T12:00:00+01:00",
          excerpt: "old stop",
          kind: "page",
        },
      ],
      edges: [],
      botPageMap: { dashboard: "p1", logic: "p2" },
      stats: { pages: 2, edges: 0, botsMapped: 2 },
    };
    const v = buildNotionMirrorView({
      bots: [bot("dashboard", "Dashboard Bot"), bot("logic", "Logic Bot"), bot("conductor", "Conductor")],
      graph,
      nowMs: NOW,
      staleMs: 6 * 3600_000,
    });
    assert.equal(v.available, true);
    assert.equal(v.mappedCount, 2);
    const dash = v.rows.find((r) => r.botId === "dashboard")!;
    assert.equal(dash.stale, false);
    assert.ok(!dash.title!.includes("<"));
    const logic = v.rows.find((r) => r.botId === "logic")!;
    assert.equal(logic.stale, true);
    assert.equal(logic.freshLabel, "stale");
    const cond = v.rows.find((r) => r.botId === "conductor")!;
    assert.equal(cond.pageId, null);
    assert.equal(cond.freshLabel, NO_MIRROR_SOURCE);
    assert.equal(freshnessLabel(30 * 60_000, false).includes("m"), true);
  });
});
