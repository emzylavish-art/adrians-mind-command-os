import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterEdgeRecsByVisibility } from "./edge-visibility.ts";

describe("edge-visibility (Gap#26)", () => {
  const recs = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "x", to: "y" },
  ];

  it("null filters return a shallow copy of all edges", () => {
    const out = filterEdgeRecsByVisibility(recs, null, null);
    assert.equal(out.length, 3);
    assert.notEqual(out, recs);
  });

  it("nhop filter wins over graph filter", () => {
    const nhop = new Set(["a", "b"]);
    const graph = new Set(["x", "y"]);
    const out = filterEdgeRecsByVisibility(recs, nhop, graph);
    assert.deepEqual(out.map((e) => `${e.from}>${e.to}`), ["a>b"]);
  });

  it("graph filter when nhop is null", () => {
    const graph = new Set(["b", "c"]);
    const out = filterEdgeRecsByVisibility(recs, null, graph);
    assert.deepEqual(out.map((e) => `${e.from}>${e.to}`), ["b>c"]);
  });

  it("empty set filters everything out without throwing", () => {
    const out = filterEdgeRecsByVisibility(recs, new Set(), null);
    assert.equal(out.length, 0);
  });
});
