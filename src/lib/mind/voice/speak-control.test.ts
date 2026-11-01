import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SharedAudioOutput } from "./audio-output.ts";
import { interruptMessageSpeak, shouldIgnoreSpeakResult } from "./speak-control.ts";

describe("speak cutoff control", () => {
  it("aborts the TTS controller, cancels speechSynthesis, and interrupts shared audio", () => {
    const out = new SharedAudioOutput();
    const abort = new AbortController();
    let cancelled = false;
    interruptMessageSpeak({
      sharedAudio: out,
      abortSpeak: abort,
      speechSynthesis: {
        cancel: () => {
          cancelled = true;
        },
      },
    });
    assert.equal(abort.signal.aborted, true);
    assert.equal(cancelled, true);
    assert.equal(out.isPlaying, false);
  });

  it("drops stale Speak results after a newer generation or abort", () => {
    assert.equal(shouldIgnoreSpeakResult(1, 2, false), true);
    assert.equal(shouldIgnoreSpeakResult(2, 2, true), true);
    assert.equal(shouldIgnoreSpeakResult(2, 2, false), false);
  });
});
