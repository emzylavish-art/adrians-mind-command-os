import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serverHalted, setServerHalt } from "./execution-gate.ts";

describe("server execution halt", () => {
  it("starts clear and then blocks until cleared", () => {
    assert.equal(serverHalted(), false);
    assert.equal(setServerHalt(true), true);
    assert.equal(serverHalted(), true);
    assert.equal(setServerHalt(false), false);
    assert.equal(serverHalted(), false);
  });
});
