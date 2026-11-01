import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createListenGuard } from "./listen-guard.ts";

describe("listen guard (spam / single-flight)", () => {
  it("rejects a second begin until end (no duplicate sessions)", () => {
    const g = createListenGuard();
    assert.equal(g.begin(), true);
    assert.equal(g.begin(), false);
    assert.equal(g.busy, true);
    g.end();
    assert.equal(g.begin(), true);
  });
});
