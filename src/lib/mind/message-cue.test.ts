import assert from "node:assert/strict";
import test from "node:test";
import { cueMessage, dropCued, restoreCue, takeNextCue } from "./message-cue.ts";
import type { CuedMessage } from "./message-cue.ts";

test("cues a line and releases it in order", () => {
  const first = cueMessage([], "  Ask the first  ", "a");
  const second = cueMessage(first.queue, "Ask the second", "b");
  assert.equal(first.error, undefined);
  assert.deepEqual(second.queue.map((item) => item.text), ["Ask the first", "Ask the second"]);
  const released = takeNextCue(second.queue);
  assert.equal(released.next?.text, "Ask the first");
  assert.deepEqual(released.queue.map((item) => item.id), ["b"]);
});

test("does not cue a blank line", () => {
  const result = cueMessage([], "   ", "blank");
  assert.equal(result.queue.length, 0);
  assert.match(result.error ?? "", /Write the message/);
});

test("stops at eight and can remove one", () => {
  let queue: CuedMessage[] = [];
  for (let index = 0; index < 8; index += 1) {
    queue = cueMessage(queue, `line ${index}`, `id-${index}`).queue;
  }
  const blocked = cueMessage(queue, "one more", "extra");
  assert.match(blocked.error ?? "", /8 messages/);
  assert.equal(dropCued(queue, "id-3").some((item) => item.id === "id-3"), false);
  assert.equal(dropCued(queue, "id-3").length, 7);
});

test("puts an unsent line back at the front", () => {
  const held = { id: "a", text: "Ask the first" };
  const restored = restoreCue([{ id: "b", text: "Ask the second" }], held);
  assert.deepEqual(restored.map((item) => item.id), ["a", "b"]);
  assert.equal(restoreCue(restored, held).length, 2);
});
