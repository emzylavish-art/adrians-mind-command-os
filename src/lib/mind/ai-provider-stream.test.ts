import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeProviderStream } from "./ai-provider-stream.ts";
function stream(frames: unknown[]) {
  const bytes = new TextEncoder().encode(frames.map(frame => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`).join(""));
  return new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
}
test("native streaming emits deltas before completion and preserves actual model attribution", async () => {
  for (const [kind, frames] of [
    ["openai", [{ model: "actual", choices: [{ delta: { content: "Hel" } }] }, { choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] }, "[DONE]"]],
    ["anthropic", [{ type: "message_start", message: { model: "actual" } }, { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } }, { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } }, { type: "message_stop" }]],
    ["gemini", [{ modelVersion: "actual", candidates: [{ content: { parts: [{ text: "Hel" }] } }] }, { candidates: [{ content: { parts: [{ text: "lo" }] }, finishReason: "STOP" }] }]],
  ] as const) {
    const chunks: string[] = [];
    const result = await consumeProviderStream(kind, stream([...frames]), text => chunks.push(text));
    assert.equal(result.ok, true); assert.deepEqual(chunks, ["Hel", "lo"]);
    if (result.ok) { assert.equal(result.text, "Hello"); assert.equal(result.model, "actual"); }
  }
});
test("interrupted streams and tool requests cannot become successful answers", async () => {
  assert.equal((await consumeProviderStream("openai", stream([{ choices: [{ delta: { content: "partial" } }] }]), () => {})).ok, false);
  assert.equal((await consumeProviderStream("anthropic", stream([{ type: "content_block_start", content_block: { type: "tool_use" } }]), () => {})).ok, false);
});
