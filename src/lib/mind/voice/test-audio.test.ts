import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readVoiceTestAudioParam,
  resolveVoiceTestAudioUrl,
  synthesizeTone,
} from "./test-audio.ts";

describe("voice test audio", () => {
  it("only resolves in dev and maps hello/tone", () => {
    assert.equal(readVoiceTestAudioParam("?voiceTestAudio=hello", false), null);
    assert.equal(readVoiceTestAudioParam("?voiceTestAudio=hello", true), "hello");
    assert.equal(resolveVoiceTestAudioUrl("hello"), "/voice-test/hello.wav");
    assert.equal(resolveVoiceTestAudioUrl("tone"), "tone:440");
    assert.ok(synthesizeTone(24000, 0.2).length > 100);
  });
});
