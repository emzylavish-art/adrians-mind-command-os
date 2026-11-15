import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANNOT_RUN, HOSTED_ACTIONS, canRunApproved, exactAction, recordingContinuesAfterTabClose } from "./owner-flow.ts";
import { recordingEndsWithDocument } from "./task-recording.ts";

describe("owner flow", () => {
  it("offers only the four hosted actions", () => {
    assert.deepEqual(HOSTED_ACTIONS.map((item) => item.id), ["file_read", "file_write", "file_delete", "terminal"]);
  });

  it("refuses a run until that action is approved", () => {
    const decision = canRunApproved({ halted: false, approved: null, exact: exactAction("file_read") });
    assert.equal(decision.ok, false);
    assert.match(decision.message, /Approve/);
  });

  it("refuses every action while the emergency stop is on", () => {
    const decision = canRunApproved({ halted: true, approved: exactAction("file_read"), exact: exactAction("file_read") });
    assert.equal(decision.ok, false);
    assert.match(decision.message, /Emergency stop/);
  });

  it("allows a run only when the approval matches that exact action", () => {
    assert.equal(canRunApproved({ halted: false, approved: exactAction("file_write"), exact: exactAction("file_read") }).ok, false);
    assert.equal(canRunApproved({ halted: false, approved: exactAction("terminal"), exact: exactAction("terminal") }).ok, true);
    assert.equal(CANNOT_RUN.includes("Mouse"), true);
    assert.equal(CANNOT_RUN.includes("Windows desktop software"), true);
    assert.equal(recordingContinuesAfterTabClose(), false);
    assert.equal(recordingEndsWithDocument({ type: "pagehide" }), true);
    assert.equal(recordingEndsWithDocument({ type: "click" }), false);
  });
});
