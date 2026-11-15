import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignParallel, WORKSPACE_MEMORY_ID } from "./assignment.ts";

describe("assignParallel", () => {
  it("gives every bot the same task, workspace memory, and no halt or approve rights", () => {
    const task = "Read the hosted notes and write the summary.";
    const assigned = assignParallel(task, ["eve", "sol", "luna"]);

    assert.equal(assigned.length, 3);
    assert.deepEqual(
      assigned.map((row) => row.botId),
      ["eve", "sol", "luna"],
    );
    for (const row of assigned) {
      assert.equal(row.task, task);
      assert.equal(row.memoryId, "workspace");
      assert.equal(row.memoryId, WORKSPACE_MEMORY_ID);
      assert.equal(row.canHalt, false);
      assert.equal(row.canApprove, false);
    }
    assert.equal(new Set(assigned.map((row) => row.memoryId)).size, 1);
    assert.equal(assigned[0]?.task, assigned[1]?.task);
    assert.equal(assigned[1]?.task, assigned[2]?.task);
  });

  it("does not give two bots different memory ids across calls", () => {
    const first = assignParallel("Same workspace", ["eve"]);
    const second = assignParallel("Same workspace", ["builder", "sol"]);
    const ids = [...first, ...second].map((row) => row.memoryId);
    assert.deepEqual(ids, ["workspace", "workspace", "workspace"]);
    assert.equal(first[0]?.canHalt, false);
    assert.equal(second[1]?.canApprove, false);
  });

  it("skips blank bot ids and does not invent a separate brain", () => {
    const assigned = assignParallel("One list", ["eve", "", "  ", "sol"]);
    assert.deepEqual(
      assigned.map((row) => row.botId),
      ["eve", "sol"],
    );
    assert.equal("memory" in assigned[0]!, false);
    assert.equal(assigned.every((row) => row.canHalt === false && row.canApprove === false), true);
  });
});
