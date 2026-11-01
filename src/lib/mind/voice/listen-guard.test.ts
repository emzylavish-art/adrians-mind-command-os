import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createListenGuard, resolveListenAction } from "./listen-guard.ts";

describe("listen guard (spam / single-flight)", () => {
  it("rejects a second begin until end (no duplicate sessions)", () => {
    const g = createListenGuard();
    assert.equal(g.begin(), true);
    assert.equal(g.begin(), false);
    assert.equal(g.busy, true);
    g.end();
    assert.equal(g.begin(), true);
  });

  it("start mode ignores when already active (no mid-connect toggle-stop)", () => {
    assert.equal(resolveListenAction("start", true), "ignore");
    assert.equal(resolveListenAction("start", false), "start");
    assert.equal(resolveListenAction("toggle", true), "stop");
    assert.equal(resolveListenAction("toggle", false), "start");
    assert.equal(resolveListenAction("stop", true), "stop");
    assert.equal(resolveListenAction("stop", false), "stop");
  });
});
