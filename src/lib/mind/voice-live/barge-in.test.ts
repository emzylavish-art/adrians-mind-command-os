import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BARGE_IN_ECHO_GUARD_MS,
  TTS_VAD_BARGE_PROB,
  TTS_VAD_SUSTAIN_MS,
  decideBargeInCutoff,
  decideSpeakBargeIn,
} from "./barge-in.ts";

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

describe("speak-state barge-in on top of the echo guard", () => {
  const playing = {
    assistantPlaying: true,
    speakingStartedAtMs: 1_000,
    cancelAllowed: true,
  };

  it("keeps server VAD on the existing cutoff once the echo guard has passed", () => {
    const r = decideSpeakBargeIn({
      ...playing,
      source: "vad",
      nowMs: 1_000 + BARGE_IN_ECHO_GUARD_MS + 50,
    });
    assert.equal(r.fire, true);
    assert.equal(r.reason, "speech_started");
  });

  it("blocks server and local VAD inside the echo guard", () => {
    const nowMs = 1_000 + BARGE_IN_ECHO_GUARD_MS - 50;
    assert.equal(decideSpeakBargeIn({ ...playing, source: "vad", nowMs }).reason, "echo_guard");
    const local = decideSpeakBargeIn({
      ...playing,
      source: "vad",
      nowMs,
      vadProb: 0.95,
      sustainedMs: TTS_VAD_SUSTAIN_MS + 500,
    });
    assert.equal(local.fire, false);
    assert.equal(local.reason, "echo_guard");
  });

  it("requires a raised probability and sustain for local VAD after the guard", () => {
    const nowMs = 1_000 + BARGE_IN_ECHO_GUARD_MS + 20;
    const quiet = decideSpeakBargeIn({
      ...playing,
      source: "vad",
      nowMs,
      vadProb: TTS_VAD_BARGE_PROB - 0.1,
      sustainedMs: TTS_VAD_SUSTAIN_MS + 100,
    });
    assert.equal(quiet.fire, false);
    assert.equal(quiet.reason, "below_threshold");
    const brief = decideSpeakBargeIn({
      ...playing,
      source: "vad",
      nowMs,
      vadProb: TTS_VAD_BARGE_PROB,
      sustainedMs: TTS_VAD_SUSTAIN_MS - 40,
    });
    assert.equal(brief.fire, false);
    assert.equal(brief.reason, "not_sustained");
    const loud = decideSpeakBargeIn({
      ...playing,
      source: "vad",
      nowMs,
      vadProb: TTS_VAD_BARGE_PROB,
      sustainedMs: TTS_VAD_SUSTAIN_MS,
    });
    assert.equal(loud.fire, true);
  });

  it("always fires manual and esc, including inside the echo guard and while idle", () => {
    for (const source of ["manual", "esc"] as const) {
      const guarded = decideSpeakBargeIn({
        ...playing,
        source,
        nowMs: 1_050,
      });
      assert.equal(guarded.fire, true);
      assert.equal(guarded.reason, source);
      const idle = decideSpeakBargeIn({
        source,
        assistantPlaying: false,
        speakingStartedAtMs: null,
        nowMs: 1,
      });
      assert.equal(idle.fire, true);
    }
  });
});
