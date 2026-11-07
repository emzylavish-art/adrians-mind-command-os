import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildConstellations,
  buildForceLayout,
  constellationEdges,
  laneHealth,
  systemWeather,
} from "./constellations.ts";
import type { BotNode } from "./types.ts";

function bot(partial: Partial<BotNode> & Pick<BotNode, "id" | "health">): BotNode {
  return {
    name: partial.id,
    lock: null,
    branch: null,
    lastActivityAt: null,
    commits: [],
    notes: "",
    reason: "",
    ...partial,
  };
}

describe("constellations", () => {
  it("groups voice bots into one lane and takes worst health", () => {
    const bots = [
      bot({ id: "voice-integration", health: "stalled" }),
      bot({ id: "voice-wiring", health: "healthy" }),
      bot({ id: "grok-build", health: "healthy" }),
    ];
    assert.equal(laneHealth(bots, ["voice-integration", "voice-wiring"]), "stalled");
    const lanes = buildConstellations(bots);
    const voice = lanes.find((l) => l.id === "voice");
    assert.equal(voice?.health, "stalled");
    assert.deepEqual(voice?.botIds, ["voice-integration", "voice-wiring"]);
  });

  it("draws hub spokes from orchestrator and dedupes edges", () => {
    const bots = [
      bot({ id: "grok-build", health: "healthy" }),
      bot({ id: "logic", health: "healthy" }),
      bot({ id: "mcp-integration", health: "idle" }),
    ];
    const edges = constellationEdges(bots);
    assert.ok(edges.some((e) => e.from === "grok-build" && e.to === "logic" && e.kind === "hub"));
    assert.equal(edges.filter((e) => e.from === "grok-build" && e.to === "logic").length, 1);
  });

  it("builds deterministic, finite force positions for the live fleet graph", () => {
    const bots = [
      bot({ id: "grok-build", health: "healthy" }),
      bot({ id: "logic", health: "stalled" }),
      bot({ id: "mcp-integration", health: "idle" }),
      bot({ id: "voice-integration", health: "healthy" }),
      bot({ id: "voice-wiring", health: "healthy" }),
    ];
    const edges = constellationEdges(bots);
    const first = buildForceLayout(bots, edges);
    const second = buildForceLayout(bots, edges);
    assert.deepEqual([...first], [...second]);
    assert.equal(first.size, bots.length);
    for (const position of first.values()) {
      assert.equal(position.length, 3);
      assert.ok(position.every(Number.isFinite));
    }
    assert.notDeepEqual(first.get("logic"), first.get("grok-build"));
  });

  it("labels system weather from blocked/stalled dominance", () => {
    const storm = systemWeather([
      bot({ id: "logic", health: "blocked" }),
      bot({ id: "media-integration", health: "healthy" }),
    ]);
    assert.equal(storm.tone, "blocked");
    assert.match(storm.label, /Storm/i);

    const drift = systemWeather([
      bot({ id: "logic", health: "stalled" }),
      bot({ id: "mcp-integration", health: "stalled" }),
      bot({ id: "media-integration", health: "healthy" }),
    ]);
    assert.equal(drift.tone, "stalled");
  });
});
