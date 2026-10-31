import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canChangeHalt } from "./halt-policy.ts";

describe("emergency stop ownership", () => {
  it("rejects a signed-out caller", () => {
    assert.equal(canChangeHalt(null, "owner", true).ok, false);
  });

  it("rejects a different user clearing the stop", () => {
    const decision = canChangeHalt("other", "owner", true);
    assert.equal(decision.ok, false);
  });

  it("allows the owner to clear and anyone signed in to set it for themselves", () => {
    assert.equal(canChangeHalt("owner", "owner", true).ok, true);
    assert.equal(canChangeHalt("owner", null, false).ok, true);
  });
});
