import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BARGE_IN_ECHO_GUARD_MS,
  BARGE_IN_HOLD_MS,
  BARGE_IN_RMS_THRESHOLD,
  SPEAKING_MIN_VISIBLE_MS,
  createBargeInState,
  isInEchoGuard,
  reduceBargeIn,
  shouldCutPlayback,
  speakingMinVisibleMet,
} from "./barge-in.ts";

describe("barge-in cutoff state machine", () => {
  it("cuts on speech_started while speaking after echo-guard", () => {
    let state = createBargeInState();
    state = reduceBargeIn(state, { type: "session_speaking" });
    state = reduceBargeIn(state, { type: "tick", dtMs: BARGE_IN_ECHO_GUARD_MS + 10 });
    const next = reduceBargeIn(state, { type: "speech_started" });
    assert.equal(next.phase, "interrupted");
    assert.match(next.status, /Interrupted/);
    assert.equal(shouldCutPlayback(state, next), true);
  });

  it("ignores speech_started during echo-guard (TTS must not barge itself)", () => {
    const state = reduceBargeIn(createBargeInState(), { type: "session_speaking" });
    assert.equal(isInEchoGuard(state), true);
    const next = reduceBargeIn(state, { type: "speech_started" });
    assert.equal(next.phase, "speaking");
    assert.equal(shouldCutPlayback(state, next), false);
  });

  it("ignores local RMS during echo-guard then cuts after hold", () => {
    let state = reduceBargeIn(createBargeInState(), { type: "session_speaking" });
    state = reduceBargeIn(state, {
      type: "local_rms",
      level: BARGE_IN_RMS_THRESHOLD + 0.5,
      dtMs: 100,
    });
    assert.equal(state.phase, "speaking");
    assert.equal(state.hotMs, 0);
    // Advance past echo guard via ticks
    state = reduceBargeIn(state, { type: "tick", dtMs: BARGE_IN_ECHO_GUARD_MS });
    state = reduceBargeIn(state, {
      type: "local_rms",
      level: BARGE_IN_RMS_THRESHOLD + 0.01,
      dtMs: 80,
    });
    assert.equal(state.phase, "speaking");
    const next = reduceBargeIn(state, {
      type: "local_rms",
      level: BARGE_IN_RMS_THRESHOLD + 0.2,
      dtMs: 80,
    });
    assert.equal(next.phase, "interrupted");
    assert.equal(shouldCutPlayback(state, next), true);
  });

  it("tracks speaking minimum visible time", () => {
    let state = reduceBargeIn(createBargeInState(), { type: "session_speaking" });
    assert.equal(speakingMinVisibleMet(state), false);
    state = reduceBargeIn(state, { type: "tick", dtMs: SPEAKING_MIN_VISIBLE_MS });
    assert.equal(speakingMinVisibleMet(state), true);
  });

  it("resets hotMs when RMS drops below threshold", () => {
    let state = reduceBargeIn(createBargeInState(), { type: "session_speaking" });
    state = reduceBargeIn(state, { type: "tick", dtMs: BARGE_IN_ECHO_GUARD_MS });
    state = reduceBargeIn(state, { type: "local_rms", level: 0.5, dtMs: 100 });
    state = reduceBargeIn(state, { type: "local_rms", level: 0.01, dtMs: 50 });
    assert.equal(state.hotMs, 0);
    assert.equal(state.phase, "speaking");
  });

  it("manual interrupt while speaking ignores echo-guard", () => {
    let state = reduceBargeIn(createBargeInState(), { type: "session_speaking" });
    state = reduceBargeIn(state, { type: "manual_interrupt" });
    assert.equal(state.phase, "interrupted");
    state = reduceBargeIn(state, { type: "resume_listening" });
    assert.equal(state.phase, "listening");
  });

  it("does not cut on speech_started while already listening", () => {
    const state = reduceBargeIn(createBargeInState(), { type: "session_listening" });
    const next = reduceBargeIn(state, { type: "speech_started" });
    assert.equal(next.phase, "listening");
    assert.equal(shouldCutPlayback(state, next), false);
  });

  it("uses hold constant", () => {
    assert.ok(BARGE_IN_HOLD_MS >= 100);
  });
});
