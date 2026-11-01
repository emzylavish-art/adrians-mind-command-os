import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideBargeInCutoff } from "./barge-in.ts";

describe("voice-live barge-in", () => {
  it("cuts mid-delta when assistant is playing and cancel allowed", () => {
    const r = decideBargeInCutoff({
      assistantPlaying: true,
      speakingStartedAtMs: 0,
      nowMs: 5000,
      cancelAllowed: true,
    });
    assert.equal(r.cut, true);
    assert.equal(r.sendCancel, true);
  });

  it("honors echo guard shortly after assistant audio starts", () => {
    const r = decideBargeInCutoff({
      assistantPlaying: true,
      speakingStartedAtMs: 1000,
      nowMs: 1100,
      cancelAllowed: true,
      echoGuardMs: 400,
    });
    assert.equal(r.cut, false);
    assert.equal(r.reason, "echo_guard");
  });

  it("does nothing when idle / budget exhausted", () => {
    assert.equal(
      decideBargeInCutoff({
        assistantPlaying: false,
        speakingStartedAtMs: null,
        nowMs: 1,
        cancelAllowed: true,
      }).reason,
      "idle",
    );
    assert.equal(
      decideBargeInCutoff({
        assistantPlaying: true,
        speakingStartedAtMs: 0,
        nowMs: 9999,
        cancelAllowed: false,
      }).reason,
      "budget_exhausted",
    );
  });
});
