import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runResearch } from "./research.ts";

describe("research gate", () => {
  it("refuses a query without searching or citing", () => {
    const result = runResearch("Toledo Bend waterfront");
    assert.equal(result.ok, false);
    assert.equal(result.configured, false);
    assert.deepEqual(result.citations, []);
    assert.match(result.error, /Nothing was searched/);
  });

  it("asks for a query instead of inventing a result", () => {
    const result = runResearch("  ");
    assert.equal(result.citations.length, 0);
    assert.match(result.error, /Write what you want researched/);
  });
});
