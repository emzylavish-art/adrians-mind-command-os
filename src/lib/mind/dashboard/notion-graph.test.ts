import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNotionSnapshot, pageStarPositions, pageForBot } from "./notion-graph-core.ts";

describe("notion-graph", () => {
  it("parses snapshot pages/edges/bot map and ignores junk", () => {
    const snap = parseNotionSnapshot({
      generatedAt: "2026-11-01T00:00:00Z",
      source: "test",
      pages: [
        { id: "p1", title: "Root", url: "https://www.notion.so/p1", parentId: null, excerpt: "hi", kind: "page" },
        { id: "p2", title: "Child", url: "https://www.notion.so/p2", parentId: "p1", excerpt: "sec", kind: "section" },
        { bad: true },
      ],
      edges: [
        { from: "p1", to: "p2", kind: "child" },
        { from: "p2", to: "bot:logic", kind: "mentions-bot" },
      ],
      botPageMap: { logic: "p2", dashboard: "p1" },
    });
    assert.ok(snap);
    assert.equal(snap!.pages.length, 2);
    assert.equal(snap!.edges.length, 2);
    assert.equal(snap!.botPageMap.logic, "p2");
  });

  it("builds deterministic page star positions", () => {
    const a = pageStarPositions(5, 10);
    const b = pageStarPositions(5, 10);
    assert.equal(a.length, 5);
    assert.deepEqual(a, b);
  });

  it("resolves bot page from graph map", () => {
    const graph = {
      available: true,
      mode: "snapshot" as const,
      generatedAt: "t",
      pages: [{ id: "p1", title: "Dash", url: "u", parentId: null, lastEdited: null, excerpt: "e", kind: "page" }],
      edges: [],
      botPageMap: { dashboard: "p1" },
      stats: { pages: 1, edges: 0, botsMapped: 1 },
    };
    assert.equal(pageForBot(graph, "dashboard")?.title, "Dash");
    assert.equal(pageForBot(graph, "logic"), null);
  });
});
