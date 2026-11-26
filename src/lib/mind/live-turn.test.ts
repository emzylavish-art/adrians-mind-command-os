import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHAT_DISCONNECT_REPLY, consumeMindTurn, prepareTurnId, shouldStoreReply, STOPPED_REPLY } from "./live-turn.ts";
import { CHAT_TIMEOUT_REPLY } from "./turn-timeouts.ts";
import { prepareRetry } from "./transcript.ts";
import { emptyWorkspace } from "./workspace.ts";

describe("live turn", () => {
  it("takes its send ID from the server even when client and server clocks disagree", async () => {
    const serverId = `1600000000000-${crypto.randomUUID()}`;
    const id = await prepareTurnId("/turn", {}, new AbortController().signal, async (_, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(init?.cache, "no-store");
      return Response.json({ operationId: serverId });
    });
    assert.equal(id, serverId);
  });

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

  it("commits a done event while the transport is still open", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode('event: done\ndata: {"text":"complete","model":"fixture","usedIds":[]}\n\n'));
      },
      cancel() { cancelled = true; },
    });
    const timeout = setTimeout(() => controller.abort(), 1000);
    try {
      const result = await consumeMindTurn({
        url: "/fixture", body: {}, headers: {}, signal: controller.signal, onDelta: () => {},
        fetchImpl: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
      });
      assert.equal(result.ok && result.text, "complete");
      assert.equal(cancelled, true);
    } finally {
      clearTimeout(timeout);
    }
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
    assert.deepEqual(result, { ok: false, error: "Sign in is required.", code: "auth_required" });
    assert.equal(shouldStoreReply(result), false);
  });

  it("does not store a canceled reply, and retry does not duplicate the user message", async () => {
    const seen: string[] = [];
    const result = await consumeMindTurn({
      url: "/api/mind/turn",
      body: {},
      headers: {},
      signal: new AbortController().signal,
      onDelta: (text) => seen.push(text),
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('event: delta\ndata: {"text":"Part"}\n\nevent: canceled\ndata: {"error":"Stopped. The unfinished reply was not saved."}\n\n'));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    });
    assert.deepEqual(seen, ["Part"]);
    assert.equal(shouldStoreReply(result), false);
    if (!result.ok) assert.equal(result.error, STOPPED_REPLY);
    const ws = emptyWorkspace();
    ws.chats.push({
      id: "c1",
      title: "Question",
      memory: "off",
      temporary: false,
      autonomy: "ask",
      projectId: null,
      retrievalLog: [],
      messages: [{ id: "u1", role: "user", content: "Question", at: "2026-01-01T00:00:00.000Z" }],
    });
    const retry = prepareRetry(ws, "c1");
    assert.equal("error" in retry, false);
    if ("error" in retry) return;
    assert.equal(retry.text, "Question");
    assert.equal(retry.chat.messages.length, 1);
  });

  it("keeps a failed provider reply retryable and does not store it", async () => {
    const result = await consumeMindTurn({
      url: "/api/mind/turn",
      body: {},
      headers: {},
      signal: new AbortController().signal,
      onDelta: () => undefined,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('event: error\ndata: {"error":"Grok returned 503. Nothing was saved as a success."}\n\n'));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    });
    assert.equal(shouldStoreReply(result), false);
    if (!result.ok) assert.match(result.error, /503/);
  });

  it("stops a hanging stream when the browser aborts and does not store it", async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    const pending = consumeMindTurn({
      url: "/api/mind/turn",
      body: {},
      headers: {},
      signal: controller.signal,
      onDelta: (text) => {
        seen.push(text);
        controller.abort();
      },
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(streamController) {
              streamController.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"Part"}\n\n'));
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    });
    const result = await pending;
    assert.deepEqual(seen, ["Part"]);
    assert.equal(result.ok, false);
    assert.equal(shouldStoreReply(result), false);
    if (!result.ok) assert.equal(result.error, STOPPED_REPLY);
  });
});


describe("live-turn disconnect honesty", () => {
  it("a fetch network failure is not labeled as a timeout", async () => {
    const result = await consumeMindTurn({
      url: "http://local.test/api/mind/turn",
      body: {},
      headers: {},
      signal: new AbortController().signal,
      onDelta: () => undefined,
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, CHAT_DISCONNECT_REPLY);
      assert.equal(result.error.includes(CHAT_TIMEOUT_REPLY), false);
    }
  });
});


describe("live-turn HTTP 429 rate limit", () => {
  it("surfaces the server error message when status is 429 (res.ok false)", async () => {
    const result = await consumeMindTurn({
      url: "http://local.test/api/mind/turn",
      body: { text: "hi" },
      headers: {},
      signal: new AbortController().signal,
      onDelta: () => undefined,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: false, error: "Too many messages. Wait a minute and try again." }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "60" },
        })) as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /Too many messages/);
      assert.equal(result.error.includes("could not be reached"), false);
    }
  });
});
