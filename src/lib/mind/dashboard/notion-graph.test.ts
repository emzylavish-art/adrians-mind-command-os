import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchNotionGraph } from "./notion.ts";
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


describe("owner workspace graph", () => {
  it("maps only shared records and links visible instructions to the actual Notion agent", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer account-token");
      assert.equal(init?.cache, "no-store");
      const agentQuery = String(input).endsWith("/agents/query");
      calls.push(String(input));
      const body = JSON.parse(String(init?.body));
      assert.equal(body.query, undefined);
      const results = agentQuery ? [
        { object: "agent", id: "custom", name: "My Notion AI", agent_type: "custom_agent", instructions_page_id: "child" },
        { object: "agent", id: "personal", name: "Personal", agent_type: "personal_agent", instructions_page_id: "hidden" },
      ] : [
        { object: "page", id: "root", properties: {} },
        { object: "page", id: "child", parent: { page_id: "root" }, properties: { title: { title: [{ plain_text: "Instructions" }] } } },
      ];
      return Response.json({ results, has_more: !agentQuery });
    };
    const graph = await fetchNotionGraph("account-token", fetchImpl);
    assert.equal(calls.length, 2);
    assert.deepEqual(graph.stats, { pages: 2, agents: 2, edges: 2, botsMapped: 0 });
    assert.deepEqual(graph.edges, [{ from: "root", to: "child", kind: "parent" }, { from: "agent:custom", to: "child", kind: "instructions" }]);
    assert.equal(graph.pages.find((n) => n.id === "agent:personal")?.kind, "Notion personal agent");
    assert.match(graph.reason || "", /recent Notion pages/);
  });

  it("distinguishes a valid empty workspace, partial access, and total failure", async () => {
    const empty = () => Response.json({ results: [] });
    const graph = await fetchNotionGraph("t", async (route) => String(route).endsWith("/search") ? empty() : new Response(null, { status: 403 }));
    assert.equal(graph.mode, "live");
    assert.match(graph.reason || "", /0 Notion pages.*lacks access to agents/);
    assert.deepEqual(graph.pages, []);
    const broken = await fetchNotionGraph("t", async () => new Response(null, { status: 401 }));
    assert.equal(broken.available, false);
    assert.equal(broken.mode, "unavailable");
    assert.match(broken.reason || "", /Reconnect/);
    const emptyGraph = await fetchNotionGraph("t", async () => empty());
    assert.equal(emptyGraph.available, true);
    assert.match(emptyGraph.reason || "", /0 Notion AI agents/);
  });
});
