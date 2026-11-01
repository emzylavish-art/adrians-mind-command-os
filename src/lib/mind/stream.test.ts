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

  it("reads a canceled event and does not turn it into done", () => {
    const pulled = pullMindEvents('event: canceled\ndata: {"error":"Stopped. The unfinished reply was not saved."}\n\n');
    assert.equal(pulled.events[0]?.event, "canceled");
    assert.equal(pulled.events.some((event) => event.event === "done"), false);
  });
});


describe("done.model honesty", () => {
  it("does not invent grok-4.5 when the done event omits a model id", () => {
    const { events } = pullMindEvents(`event: done\ndata: ${JSON.stringify({ text: "hi", usedIds: [] })}\n\n`);
    assert.equal(events.length, 1);
    const done = events[0];
    assert.equal(done.event, "done");
    if (done.event === "done") {
      assert.equal(done.model, "model unknown");
      assert.equal(done.model.includes("grok-4.5"), false);
    }
  });

  it("keeps a confirmed non-empty model id from the done event", () => {
    const { events } = pullMindEvents(`event: done\ndata: ${JSON.stringify({ text: "hi", model: "grok-4.7", usedIds: [] })}\n\n`);
    const done = events[0];
    assert.equal(done?.event, "done");
    if (done?.event === "done") assert.equal(done.model, "grok-4.7");
  });

  it("treats blank model strings as model unknown", () => {
    const { events } = pullMindEvents(`event: done\ndata: ${JSON.stringify({ text: "hi", model: "  ", usedIds: [] })}\n\n`);
    const done = events[0];
    assert.equal(done?.event, "done");
    if (done?.event === "done") assert.equal(done.model, "model unknown");
  });
});


describe("done.model null / number / object", () => {
  for (const [label, model] of [
    ["null", null],
    ["number", 45],
    ["object", { id: "grok-4.5" }],
  ] as const) {
    it(`coerces ${label} to model unknown without inventing grok-4.5`, () => {
      const { events } = pullMindEvents(`event: done\ndata: ${JSON.stringify({ text: "hi", model, usedIds: [] })}\n\n`);
      const done = events[0];
      assert.equal(done?.event, "done");
      if (done?.event === "done") {
        assert.equal(done.model, "model unknown");
        assert.equal(done.model.includes("grok"), false);
      }
    });
  }
});
