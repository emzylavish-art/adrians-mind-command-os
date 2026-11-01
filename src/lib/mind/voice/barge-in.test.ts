import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BARGE_IN_HOLD_MS,
  BARGE_IN_RMS_THRESHOLD,
  createBargeInState,
  reduceBargeIn,
  shouldCutPlayback,
} from "./barge-in.ts";

describe("barge-in cutoff state machine", () => {
  it("cuts on speech_started while speaking", () => {
    let state = createBargeInState();
    state = reduceBargeIn(state, { type: "session_speaking" });
    const next = reduceBargeIn(state, { type: "speech_started" });
    assert.equal(next.phase, "interrupted");
    assert.match(next.status, /Interrupted/);
    assert.equal(shouldCutPlayback(state, next), true);
  });

  it("cuts after ~150ms of local RMS above threshold while speaking", () => {
    let state = reduceBargeIn(createBargeInState(), { type: "session_speaking" });
    state = reduceBargeIn(state, {
      type: "local_rms",
      level: BARGE_IN_RMS_THRESHOLD + 0.01,
      dtMs: 80,
    });
    assert.equal(state.phase, "speaking");
    assert.ok(state.hotMs < BARGE_IN_HOLD_MS);
    const next = reduceBargeIn(state, {
      type: "local_rms",
      level: BARGE_IN_RMS_THRESHOLD + 0.2,
      dtMs: 80,
    });
    assert.equal(next.phase, "interrupted");
    assert.match(next.status, /Interrupted — listening/);
    assert.equal(shouldCutPlayback(state, next), true);
  });

  it("resets hotMs when RMS drops below threshold", () => {
    let state = reduceBargeIn(createBargeInState(), { type: "session_speaking" });
    state = reduceBargeIn(state, { type: "local_rms", level: 0.5, dtMs: 100 });
    state = reduceBargeIn(state, { type: "local_rms", level: 0.01, dtMs: 50 });
    assert.equal(state.hotMs, 0);
    assert.equal(state.phase, "speaking");
  });

  it("manual interrupt while speaking", () => {
    let state = reduceBargeIn(createBargeInState(), { type: "session_speaking" });
    state = reduceBargeIn(state, { type: "manual_interrupt" });
    assert.equal(state.phase, "interrupted");
    state = reduceBargeIn(state, { type: "resume_listening" });
    assert.equal(state.phase, "listening");
  });

  it("does not cut on speech_started while already listening", () => {
    let state = reduceBargeIn(createBargeInState(), { type: "session_listening" });
    const next = reduceBargeIn(state, { type: "speech_started" });
    assert.equal(next.phase, "listening");
    assert.equal(shouldCutPlayback(state, next), false);
  });
});
