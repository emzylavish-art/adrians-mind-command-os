import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { destructiveSpeechRefusal, dryRun, REVERSIBILITY_STATUS, ROLLBACK_TARGET, rollBack } from "./reversibility.ts";

describe("reversibility", () => {
  it("refuses an empty action and a missing permission", () => {
    assert.equal(dryRun({ id: "a", action: " ", reversible: true, permitted: true }).reason, "empty action");
    assert.equal(dryRun({ id: "a", action: "delete file", reversible: true, permitted: false }).reason, "permission missing");
  });

  it("does not execute or restore, even when the action is marked reversible", () => {
    const result = dryRun({ id: "a", action: "rename file", reversible: true, permitted: true });
    assert.equal(result.executed, false);
    assert.equal(result.wouldRefuse, false);
    assert.equal(rollBack().restored, false);
    assert.equal(ROLLBACK_TARGET, "not connected");
    assert.equal(REVERSIBILITY_STATUS, "available-contract");
  });

  it("refuses a spoken wipe and leaves an ordinary sentence alone", () => {
    assert.match(destructiveSpeechRefusal("wipe the disk") ?? "", /Nothing was deleted/);
    assert.equal(destructiveSpeechRefusal("list my files"), null);
  });
});
