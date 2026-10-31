import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { consumeMindTurn } from "./live-turn.ts";

describe("live turn", () => {
  it("shows deltas and commits only the finished reply", async () => {
    const seen: string[] = [];
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('event: delta\ndata: {"text":"Hel"}\n\n'));
        controller.enqueue(encoder.encode('event: done\ndata: {"text":"Hello","model":"grok-4.5","usage":null,"usedIds":[],"requestId":null}\n\n'));
        controller.close();
      },
    });
    const result = await consumeMindTurn({
      url: "/api/mind/turn",
      body: {},
      headers: {},
      signal: new AbortController().signal,
      onDelta: (text) => seen.push(text),
      fetchImpl: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
    });
    assert.deepEqual(seen, ["Hel"]);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.text, "Hello");
  });

  it("does not keep a reply when the server reports an error", async () => {
    const result = await consumeMindTurn({
      url: "/api/mind/turn",
      body: {},
      headers: {},
      signal: new AbortController().signal,
      onDelta: () => undefined,
      fetchImpl: async () => new Response(JSON.stringify({ error: "Sign in is required." }), { status: 401, headers: { "content-type": "application/json" } }),
    });
    assert.deepEqual(result, { ok: false, error: "Sign in is required." });
  });
});
