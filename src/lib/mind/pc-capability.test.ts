import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missingPcCapabilities, PC_CAPABILITIES } from "./pc-capability.ts";

describe("PC capability record", () => {
  it("does not mark unproven computer-use layers as coded", () => {
    const missing = missingPcCapabilities();
    for (const id of ["visual-understanding", "accessibility-tree", "window-management", "browser-automation", "background-worker", "robotics"]) {
      assert.equal(missing.includes(id), true);
    }
    assert.equal(PC_CAPABILITIES.find((item) => item.id === "screen-capture")?.state, "coded");
  });
});
