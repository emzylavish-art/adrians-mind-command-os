import assert from "node:assert/strict";
import test from "node:test";
import { replyVoiceForTurn, shouldSpeakTranscriptAgain } from "./one-voice.ts";

test("a live direct turn keeps the live voice and does not speak again", () => {
  const voice = replyVoiceForTurn({ liveSessionOpen: true, mode: "direct", placingCall: false });
  assert.equal(voice, "live");
  assert.equal(shouldSpeakTranscriptAgain(voice), false);
});

test("a placed call is the only voice", () => {
  const voice = replyVoiceForTurn({ liveSessionOpen: true, mode: "direct", placingCall: true });
  assert.equal(voice, "call");
  assert.equal(shouldSpeakTranscriptAgain(voice), false);
});

test("a live orchestrator turn does not add a second model voice", () => {
  const voice = replyVoiceForTurn({ liveSessionOpen: true, mode: "orchestrator", placingCall: false });
  assert.equal(voice, "live");
  assert.equal(shouldSpeakTranscriptAgain(voice), false);
});

test("a closed session uses the model voice once", () => {
  const voice = replyVoiceForTurn({ liveSessionOpen: false, mode: "direct", placingCall: false });
  assert.equal(voice, "model");
  assert.equal(shouldSpeakTranscriptAgain(voice), true);
});
