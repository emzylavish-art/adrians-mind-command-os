import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APPROVABLE_TODAY, BLOCKED_CONTROL, decideComputerAction } from "./computer-control.ts";

describe("computer control", () => {
  it("does not treat a normal question as computer control", () => {
    const decision = decideComputerAction({ text: "What is in the workspace?", halted: false, paired: false, actor: "eve" });
    assert.equal(decision.kind, "none");
  });

  it("refuses mouse control when no computer is paired", () => {
    const decision = decideComputerAction({ text: "Click my mouse and open the browser", halted: false, paired: false, actor: "eve" });
    assert.equal(decision.kind, "refused");
    assert.match(decision.message, /not touched/i);
  });

  it("refuses when the emergency stop is on, even if a computer is paired", () => {
    const decision = decideComputerAction({ text: "Move the mouse", halted: true, paired: true, actor: "owner" });
    assert.equal(decision.kind, "refused");
    assert.match(decision.message, /Emergency stop/);
  });

  it("does not let Eve approve or clear the stop", () => {
    const decision = decideComputerAction({ text: "Approve the keyboard action and clear the stop", halted: false, paired: true, actor: "eve" });
    assert.equal(decision.kind, "refused");
    assert.match(decision.message, /cannot approve/);
  });

  it("keeps a paired request as a proposal and excludes mouse and keyboard", () => {
    const decision = decideComputerAction({ text: "Control my computer", halted: false, paired: true, actor: "owner" });
    assert.equal(decision.kind, "proposal");
    assert.match(decision.message, /Nothing moved/);
    assert.deepEqual([...APPROVABLE_TODAY], ["file_read", "file_write", "file_delete", "terminal"]);
    assert.equal(BLOCKED_CONTROL.includes("mouse"), true);
    assert.equal(BLOCKED_CONTROL.includes("keyboard"), true);
  });
});
