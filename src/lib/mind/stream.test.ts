import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSseFeed, pullMindEvents, pushSse, readModelPayload } from "./stream.ts";

describe("model payload", () => {
  it("reads a normal JSON reply", () => {
    const parsed = readModelPayload(JSON.stringify({ choices: [{ message: { content: "Hello" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    assert.equal(parsed.streamed, false);
    assert.equal(parsed.text, "Hello");
    assert.equal(parsed.usage?.prompt_tokens, 3);
  });

  it("assembles streamed deltas and ignores the done marker", () => {
    const raw = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":2,"completion_tokens":1}}',
      "data: [DONE]",
    ].join("\n");
    const parsed = readModelPayload(raw);
    assert.equal(parsed.streamed, true);
    assert.equal(parsed.text, "Hello");
    assert.equal(parsed.usage?.completion_tokens, 1);
  });

  it("rejects a broken stream instead of inventing a reply", () => {
    const parsed = readModelPayload("data: {not json");
    assert.equal(parsed.text, "");
    assert.equal(parsed.streamed, true);
  });

  it("emits deltas as chunks arrive and drops the text when a later chunk is broken", () => {
    const feed = createSseFeed();
    const first = pushSse(feed, 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n');
    assert.deepEqual(first.deltas, ["Hel"]);
    const second = pushSse(feed, "data: {not json\n");
    assert.equal(second.bad, true);
    assert.deepEqual(second.deltas, []);
  });
});

describe("client reply events", () => {
  it("keeps an unfinished block and reads a completed delta", () => {
    const partial = pullMindEvents('event: delta\ndata: {"text":"Hi"}');
    assert.equal(partial.events.length, 0);
    const done = pullMindEvents(`${partial.rest}\n\n`);
    assert.equal(done.events[0]?.event, "delta");
    if (done.events[0]?.event === "delta") assert.equal(done.events[0].text, "Hi");
  });
});
