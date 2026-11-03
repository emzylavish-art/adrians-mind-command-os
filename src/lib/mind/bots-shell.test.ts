import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBotsShellPath, viewFromBotsPath } from "./bots-shell.ts";

describe("bots-shell deep links", () => {
  it("maps /bots and /agents to the agents view", () => {
    assert.equal(viewFromBotsPath("/bots"), "agents");
    assert.equal(viewFromBotsPath("/agents"), "agents");
    assert.equal(viewFromBotsPath("/bots/"), "agents");
    assert.equal(viewFromBotsPath("/"), null);
    assert.equal(viewFromBotsPath("/dashboard"), null);
    assert.equal(isBotsShellPath("/bots"), true);
    assert.equal(isBotsShellPath("/login"), false);
  });
});
