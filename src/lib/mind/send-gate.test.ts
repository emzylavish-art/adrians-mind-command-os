import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canSend } from "./send-gate.ts";

describe("send gate", () => {
  it("blocks send while emergency stop is on", () => {
    const result = canSend({ halted: true, busy: false });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /Emergency stop is on/);
  });

  it("allows send after clear when not busy", () => {
    const result = canSend({ halted: false, busy: false });
    assert.equal(result.ok, true);
  });

  it("blocks while busy even if not halted", () => {
    const result = canSend({ halted: false, busy: true });
    assert.equal(result.ok, false);
  });
});
