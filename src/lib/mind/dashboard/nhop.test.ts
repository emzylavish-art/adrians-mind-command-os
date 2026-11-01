import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nhopBotIds } from "./nhop.ts";
import type { ConstellationEdge } from "./constellations.ts";

describe("nhop (#28 Gap#6)", () => {
  const edges: ConstellationEdge[] = [
    { from: "grok-build", to: "conductor", kind: "hub", health: "healthy" },
    { from: "conductor", to: "gap-dispatcher", kind: "lane", health: "stalled" },
    { from: "logic", to: "visual-polish", kind: "lane", health: "healthy" },
  ];
  it("depth 0 is just the root", () => {
    assert.deepEqual([...nhopBotIds("conductor", edges, 0)].sort(), ["conductor"]);
  });
  it("depth 1 includes direct neighbors", () => {
    const s = nhopBotIds("conductor", edges, 1);
    assert.ok(s.has("conductor") && s.has("grok-build") && s.has("gap-dispatcher"));
    assert.equal(s.has("logic"), false);
  });
  it("depth 2 reaches across hub", () => {
    const s = nhopBotIds("gap-dispatcher", edges, 2);
    assert.ok(s.has("grok-build"));
  });
});
