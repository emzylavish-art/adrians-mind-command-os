import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replyActions } from "./reply-actions.ts";

describe("reply actions", () => {
  it("shows stop instead of play and regenerate while those states are active", () => {
    const actions = replyActions({ role: "assistant", busy: true, speaking: true, hasSources: false });
    assert.equal(actions.includes("read-aloud"), false);
    assert.equal(actions.includes("regenerate"), false);
    assert.equal(actions.includes("stop-playback"), true);
    assert.equal(actions.includes("stop-generating"), true);
  });

  it("hides sources until the reply actually has them", () => {
    assert.equal(replyActions({ role: "assistant", busy: false, speaking: false, hasSources: false }).includes("sources"), false);
    assert.equal(replyActions({ role: "assistant", busy: false, speaking: false, hasSources: true }).includes("sources"), true);
  });
});
