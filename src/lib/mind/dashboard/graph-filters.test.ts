import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  botMatchesGraphFilter,
  connectedBotIds,
  DEFAULT_GRAPH_FILTER,
  filterBotIds,
} from "./graph-filters.ts";
import type { BotNode } from "./types.ts";
import type { ConstellationEdge } from "./constellations.ts";

function bot(partial: Partial<BotNode> & { id: string; name: string }): BotNode {
  return {
    health: "healthy",
    lock: null,
    branch: null,
    lastActivityAt: null,
    commits: [],
    notes: "",
    reason: "",
    ...partial,
  } as BotNode;
}

describe("graph-filters (#27 Gap#5)", () => {
  it("orphansOnly keeps bots with no edges", () => {
    const bots = [bot({ id: "conductor", name: "Conductor" }), bot({ id: "logic", name: "Logic" })];
    const edges: ConstellationEdge[] = [
      { from: "conductor", to: "grok-build", kind: "hub", health: "healthy" },
    ];
    const connected = connectedBotIds(edges);
    assert.equal(botMatchesGraphFilter(bots[0]!, { ...DEFAULT_GRAPH_FILTER, orphansOnly: true }, connected), false);
    assert.equal(botMatchesGraphFilter(bots[1]!, { ...DEFAULT_GRAPH_FILTER, orphansOnly: true }, connected), true);
  });

  it("query + health filter compose", () => {
    const bots = [
      bot({ id: "visual-polish", name: "Visual Polish Bot", health: "stalled" }),
      bot({ id: "logic", name: "Logic Bot", health: "healthy" }),
    ];
    const ids = filterBotIds(bots, [], { ...DEFAULT_GRAPH_FILTER, query: "visual", health: "stalled" });
    assert.deepEqual([...ids], ["visual-polish"]);
  });
});
