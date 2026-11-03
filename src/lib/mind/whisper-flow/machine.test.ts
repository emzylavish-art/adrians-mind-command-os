import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWhisperFlowState, finishWhisperFlow, reduceWhisperFlow } from "./machine.ts";

describe("whisper-flow machine", () => {
  it("starts listening from idle and resets error", () => {
    let s = createWhisperFlowState();
    s = reduceWhisperFlow(s, { type: "error", message: "boom" });
    assert.equal(s.phase, "error");
    s = reduceWhisperFlow(s, { type: "start" });
    assert.equal(s.phase, "listening");
    assert.equal(s.error, null);
    assert.match(s.status || "", /listening/i);
  });

  it("supports pause and resume", () => {
    let s = reduceWhisperFlow(createWhisperFlowState(), { type: "start" });
    s = reduceWhisperFlow(s, { type: "pause" });
    assert.equal(s.phase, "paused");
    s = reduceWhisperFlow(s, { type: "resume" });
    assert.equal(s.phase, "listening");
  });

  it("accumulates inserted text on chunk_ok and finishes to idle", () => {
    let s = reduceWhisperFlow(createWhisperFlowState(), { type: "start" });
    s = reduceWhisperFlow(s, { type: "chunk_ok", text: "hello" });
    assert.equal(s.insertedText, "hello");
    assert.equal(s.phase, "listening");
    s = reduceWhisperFlow(s, { type: "chunk_ok", text: "world" });
    assert.equal(s.insertedText, "hello world");
    s = reduceWhisperFlow(s, { type: "stop_begin" });
    assert.equal(s.phase, "transcribing");
    s = finishWhisperFlow(s);
    assert.equal(s.phase, "idle");
    assert.match(s.status || "", /stopped/i);
  });

  it("marks errors retryable by default", () => {
    const s = reduceWhisperFlow(createWhisperFlowState(), {
      type: "error",
      message: "Speech-to-text did not answer in time. Nothing was transcribed.",
    });
    assert.equal(s.phase, "error");
    assert.equal(s.retryable, true);
    const next = reduceWhisperFlow(s, { type: "retry" });
    assert.equal(next.phase, "listening");
  });
});
