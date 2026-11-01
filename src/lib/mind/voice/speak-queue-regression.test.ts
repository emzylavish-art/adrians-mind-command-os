import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { completeSpeak, createSpeakQueue, enqueueSpeak } from "./spam-guard.ts";
import { expectedTranscriptForTestAudio } from "./test-audio.ts";

describe("named test-audio clips", () => {
  it("maps hello and question honestly for dictation + realtime", () => {
    assert.equal(expectedTranscriptForTestAudio("hello"), "hello");
    assert.equal(expectedTranscriptForTestAudio("question"), "What time is it?");
  });
});

describe("speak queue vs responseBusy stranding", () => {
  it("keeps a pending speak through busy→idle so Direct can reach Speaking", () => {
    const q = createSpeakQueue();
    assert.equal(enqueueSpeak(q, "It is about noon."), "start");
    // Simulate auto-reply busy period: another enqueue while "active"
    assert.equal(enqueueSpeak(q, "It is about noon."), "ignore");
    // After done with no pending, queue is empty — caller must re-enqueue or flush array
    assert.equal(completeSpeak(q), null);
    // Re-start after stranded busy (the session fix resets speakQ when ignore+empty)
    assert.equal(enqueueSpeak(q, "It is about noon."), "start");
    assert.equal(q.active, "It is about noon.");
  });
});
