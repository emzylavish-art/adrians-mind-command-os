import assert from "node:assert/strict";
import { test } from "node:test";
import { messageWindow } from "./render-window.ts";

test("large conversations mount a bounded tail without discarding history", () => {
  for (const length of [1, 50, 500, 2000]) {
    const messages = Array.from({ length }, (_, index) => ({ id: String(index) }));
    const first = messageWindow(messages);
    assert.equal(first.messages.length, Math.min(length, 100));
    assert.equal(first.hiddenCount + first.messages.length, length);
    const more = messageWindow(messages, 200);
    assert.equal(more.messages.length, Math.min(length, 200));
    assert.equal(messages.length, length);
    assert.equal(messageWindow(messages, 100, "0").messages[0]?.id, "0");
  }
});
