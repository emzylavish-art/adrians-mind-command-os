import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTurnReceipt, consumeMindTurn, prepareTurnId, shouldStoreReply, STOPPED_REPLY } from "./live-turn.ts";
import { createSseFeed, pullMindEvents, pushSse, readModelPayload } from "./stream.ts";
import { readExecutionReceipts } from "./execution-receipt.ts";
import { withExecutionReceipts } from "./execution-response.ts";
import { relayModelStream } from "./relay.ts";
import { CHAT_TIMEOUT_REPLY } from "./turn-timeouts.ts";
import type { ConsultExecutionReceipt } from "./model-consult.ts";

const helper: ConsultExecutionReceipt = {
  executionId: "operation:helper:0", parentOperationId: "operation", role: "helper", provider: "gemini",
  requestedModel: "chosen-model", model: "answered-model", requestId: "fixture-request",
  usage: { prompt_tokens: 12, completion_tokens: 4 }, executionLocation: "hosted", outcome: "completed",
};
const event = (name: string, value: unknown, newline = "\n") => `event: ${name}${newline}data: ${JSON.stringify(value)}${newline}${newline}`;
const done = { text: "Hello 🌍", model: "fixture-model", provider: "fixture", usage: { completion_tokens: 3 }, usedIds: [], requestId: "fixture-primary" };
function streaming(text: string, options: { splitBytes?: boolean; close?: boolean; cancel?: () => Promise<void> | void } = {}) {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (options.splitBytes) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      else controller.enqueue(bytes);
      if (options.close !== false) controller.close();
    },
    cancel: options.cancel,
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}
async function consume(response: Response, onDelta: (text: string) => void = () => {}, signal = new AbortController().signal) {
  return consumeMindTurn({ url: "/fixture/turn", body: {}, headers: {}, signal, onDelta, fetchImpl: async () => response });
}

test("AA041 JSON answers containing data: remain JSON; provider errors and malformed deltas never become success", () => {
  const parsed = readModelPayload(JSON.stringify({ choices: [{ message: { content: "Use data: labels" } }], model: "actual" }));
  assert.deepEqual(parsed, { text: "Use data: labels", model: "actual", streamed: false, usage: null });
  for (const last of [{ error: { message: "provider failed" } }, { choices: [{ delta: { content: { unsafe: true } } }] }]) {
    const raw = `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\ndata: ${JSON.stringify(last)}\n\n`;
    assert.equal(readModelPayload(raw).text, "");
    const feed = createSseFeed();
    assert.equal(pushSse(feed, raw).bad, true);
  }
});

test("AA041 upstream DONE is terminal and cannot append later deltas or lose confirmed usage", () => {
  const feed = createSseFeed();
  const first = pushSse(feed, 'data: {"choices":[{"delta":{"content":"ha"}}],"model":"actual"}\r\n');
  assert.deepEqual(first.deltas, ["ha"]);
  const end = pushSse(feed, 'data: {"choices":[{"delta":{"content":"ha"}}],"usage":{"completion_tokens":2}}\r\ndata: [DONE]\r\ndata: {"choices":[{"delta":{"content":"ignored"}}]}\n');
  assert.deepEqual(end.deltas, ["ha"]);
  assert.equal(feed.text, "haha");
  assert.equal(feed.usage?.completion_tokens, 2);
  assert.equal(feed.done, true);
  assert.deepEqual(pushSse(feed, 'data: {"choices":[{"delta":{"content":"late"}}]}\n').deltas, []);
});

test("AA041 the upstream terminal marker finishes the answer without waiting for socket EOF", { timeout: 2_000 }, async () => {
  let cancelled = false;
  let dispatched = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"complete"}}],"model":"fixture-actual"}\n\ndata: [DONE]\n\n'));
    },
    cancel() { cancelled = true; },
  });
  const response = relayModelStream({ apiKey: "synthetic-not-a-key", model: "fixture-selected", messages: [], usedIds: [],
    requestSignal: new AbortController().signal, timeoutMs: 100,
    onDispatch: () => { dispatched += 1; },
    fetchImpl: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
  });
  const result = await consume(response);
  assert.equal(result.ok && result.text, "complete");
  assert.equal(result.ok && result.model, "fixture-actual");
  assert.equal(cancelled, true);
  assert.equal(dispatched, 1);
});

test("AA043/046 relay cancellation before inference does not mark a primary dispatch", async () => {
  const controller = new AbortController();
  controller.abort();
  let dispatched = 0;
  let calls = 0;
  const response = relayModelStream({ apiKey: "synthetic-not-a-key", model: "fixture", messages: [], usedIds: [], requestSignal: controller.signal,
    onDispatch: () => { dispatched += 1; },
    fetchImpl: async () => { calls += 1; throw new Error("No fetch expected"); },
  });
  const result = await consume(response);
  assert.equal(result.ok, false);
  assert.equal(dispatched, 0);
  assert.equal(calls, 0);
});

test("AA041 every CRLF boundary and UTF-8 byte boundary produces the same visible and final text as LF", async () => {
  for (const newline of ["\n", "\r\n"]) {
    const text = event("delta", { text: "Hello " }, newline) + event("delta", { text: "🌍" }, newline) + event("done", done, newline);
    const seen: string[] = [];
    const result = await consume(streaming(text, { splitBytes: true }), (delta) => seen.push(delta));
    assert.deepEqual(seen, ["Hello ", "🌍"]);
    assert.equal(result.ok && result.text, "Hello 🌍");
    assert.equal(result.ok && result.model, "fixture-model");
    assert.equal("executions" in result, false, "old results without receipts retain their shape");
  }
  const fragment = pullMindEvents('event: delta\r\ndata: {"text":"one"}\r');
  assert.deepEqual(fragment.events, []);
  assert.deepEqual(pullMindEvents(fragment.rest + "\n\r\n").events, [{ event: "delta", text: "one" }]);
});

test("AA041 final done is authoritative; repeated legitimate deltas are not deduplicated by content", async () => {
  const seen: string[] = [];
  const result = await consume(streaming(event("delta", { text: "ha" }) + event("delta", { text: "ha" }) + event("done", { ...done, text: "haha!" })), (text) => seen.push(text));
  assert.deepEqual(seen, ["ha", "ha"]);
  assert.equal(result.ok && result.text, "haha!", "the stored response is the authoritative done payload, not concatenated preview text");
  assert.equal(shouldStoreReply(result), true);
});

test("AA041 a bare DONE marker, broken frame, error, canceled, and premature EOF cannot store a completed answer", async () => {
  for (const ending of ["data: [DONE]\n\n", "event: done\ndata: {broken}\n\n", event("error", { error: "Fixture unavailable" }), event("canceled", { error: "legacy stopped wording" }), ""]) {
    const seen: string[] = [];
    const result = await consume(streaming(event("delta", { text: "partial" }) + ending), (text) => seen.push(text));
    assert.deepEqual(seen, ["partial"]);
    assert.equal(shouldStoreReply(result), false);
    assert.equal(result.ok, false);
    if (!result.ok && ending.includes("canceled")) assert.equal(result.error, STOPPED_REPLY);
  }
});

test("AA041 Stop and timeout finish promptly even if upstream reader cancellation never resolves", { timeout: 2_000 }, async () => {
  for (const reason of [undefined, new DOMException("Fixture timeout", "TimeoutError")]) {
    const controller = new AbortController();
    let cancellationRequested = false;
    const response = streaming(event("delta", { text: "partial" }), {
      close: false, cancel: () => { cancellationRequested = true; return new Promise<void>(() => {}); },
    });
    const result = await consume(response, () => controller.abort(reason), controller.signal);
    assert.equal(cancellationRequested, true);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, reason ? CHAT_TIMEOUT_REPLY : STOPPED_REPLY);
  }
});

test("AA043/046 receipts survive final success, error, canceled, EOF, client stop, and timeout", async () => {
  const prefix = event("executions", { executions: [helper] });
  for (const ending of [event("done", { ...done, executionLocation: "local" }), event("error", { error: "final failed" }), event("canceled", { error: "stopped" }), ""]) {
    const result = await consume(streaming(prefix + event("delta", { text: "partial" }) + ending));
    assert.deepEqual(result.executions, [helper]);
    if (result.ok) assert.equal(result.executionLocation, "local");
  }
  for (const reason of [undefined, new DOMException("Fixture timeout", "TimeoutError")]) {
    const controller = new AbortController();
    const result = await consume(streaming(prefix + event("delta", { text: "partial" }), { close: false }), () => controller.abort(reason), controller.signal);
    assert.deepEqual(result.executions, [helper]);
    assert.equal(result.ok, false);
  }
});

test("AA043/046 helper receipts survive JSON final-model failure and reconnect GET without resending", async () => {
  const result = await consume(Response.json({ error: "Final provider failed", executions: [helper, { provider: "fabricated" }] }, { status: 503 }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.executions, [helper]);
  const methods: string[] = [];
  const receipt = await checkTurnReceipt("/fixture/turn", "operation", {}, undefined, async (url, init) => {
    methods.push(init?.method ?? "");
    assert.equal(url, "/fixture/turn?operationId=operation");
    assert.equal(init?.cache, "no-store");
    return Response.json({ state: "responded", ownerId: "owner-a", executions: [helper, { ...helper, executionId: "another-operation:helper:0", parentOperationId: "another-operation" }] });
  });
  assert.deepEqual(receipt, { state: "responded", ownerId: "owner-a", executions: [helper] });
  assert.deepEqual(methods, ["GET"]);
  const old = await checkTurnReceipt("/fixture/turn", "original-operation", {}, undefined, async () => Response.json({ state: "unknown", ownerId: "owner-a" }));
  assert.deepEqual(old, { state: "unknown", ownerId: "owner-a" });
});

test("AA043/046 stream receipts stay bound to the actual send header", async () => {
  const other = { ...helper, executionId: "other:helper:0", parentOperationId: "other" };
  const result = await consumeMindTurn({ url: "/fixture/turn", headers: { "x-mind-turn-id": "operation" },
    body: { operationId: "other" }, signal: new AbortController().signal, onDelta: () => {},
    fetchImpl: async () => streaming(event("executions", { executions: [helper, other] }) + event("error", { error: "Primary stopped" })),
  });
  assert.deepEqual(result.executions, [helper]);
});

test("AA043/046 server prefix transport retains receipts when a final stream disconnects", async () => {
  let upstream: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    upstream = controller;
    controller.enqueue(new TextEncoder().encode(event("delta", { text: "partial" })));
  } });
  const wrapped = await withExecutionReceipts(new Response(body, { headers: { "content-type": "text/event-stream" } }), [helper]);
  const result = await consume(wrapped, () => upstream.error(new Error("Fixture transport disconnected")));
  assert.equal(result.ok, false);
  assert.deepEqual(result.executions, [helper]);
  assert.equal(shouldStoreReply(result), false);
});

test("AA043/046 failure accounting distinguishes a dispatched primary from helpers-only execution", async () => {
  for (const value of ["0", "1", "unknown", undefined]) {
    for (const protocol of ["json", "sse"]) {
      const headers: Record<string, string> = value === undefined ? {} : { "x-mind-primary-dispatched": value };
      const response = protocol === "json"
        ? Response.json({ error: "Final answer unavailable", executions: [helper] }, { status: 503, headers })
        : new Response(event("executions", { executions: [helper] }) + event("error", { error: "Final answer unavailable" }), {
          headers: { ...headers, "content-type": "text/event-stream" },
        });
      const result = await consume(response);
      assert.equal(result.ok, false);
      assert.deepEqual(result.executions, [helper]);
      if (!result.ok) {
        assert.equal(result.primaryDispatched, value === "1" ? true : value === "0" ? false : undefined);
        assert.equal("primaryDispatched" in result, value === "0" || value === "1", "missing metadata remains unknown");
      }
    }
  }
});

test("AA043/046 a completed local tool reply can explicitly report no primary model dispatch", async () => {
  for (const value of ["0", "1", undefined]) {
    const headers = new Headers({ "content-type": "text/event-stream" });
    if (value) headers.set("x-mind-primary-dispatched", value);
    const result = await consume(new Response(event("done", { ...done, model: "adrian-local", provider: "Adrian" }), { headers }));
    assert.equal(shouldStoreReply(result), true, "local replies are still valid assistant messages");
    assert.equal(result.primaryDispatched, value === "0" ? false : value === "1" ? true : undefined);
    assert.equal("primaryDispatched" in result, value !== undefined);
  }
});

test("AA043/046 failed primary retains only reported identity and valid token counters", async () => {
  const metadata = { provider: "gemini", model: "actual-primary", requestedModel: "selected-primary", requestId: "failed-request",
    usage: { prompt_tokens: 9, completion_tokens: 0 }, executionLocation: "hosted" };
  for (const protocol of ["json", "sse"]) {
    const payload = { error: "Primary failed", ...metadata };
    const response = protocol === "json" ? Response.json(payload, { status: 500, headers: { "x-mind-primary-dispatched": "1" } })
      : new Response(event("error", payload), { headers: { "content-type": "text/event-stream", "x-mind-primary-dispatched": "1" } });
    assert.deepEqual(await consume(response), { ok: false, error: "Primary failed", code: protocol === "json" ? "service_unavailable" : "unknown", deliveryUncertain: true, primaryDispatched: true, ...metadata });
  }
  const invalid = await consume(Response.json({ error: "Unknown receipt", usage: { prompt_tokens: -1, completion_tokens: 1.2 },
    provider: {}, model: "", requestedModel: false, requestId: "unsafe\nvalue", executionLocation: "guess" }, { status: 500 }));
  assert.deepEqual(invalid, { ok: false, error: "Unknown receipt", code: "service_unavailable", deliveryUncertain: true, usage: null });
  const missing = await consume(Response.json({ error: "No receipt" }, { status: 401 }));
  assert.deepEqual(missing, { ok: false, code: "auth_required", error: "No receipt" });
});

test("AA043/046 receipt validation rejects false identities and usage, strips extra material, and counts repeated IDs once", () => {
  const safe = readExecutionReceipts([
    { ...helper, secret: "must not propagate" },
    { ...helper, outcome: "unknown", usage: null },
    { ...helper, executionId: "bad-location", executionLocation: "guess" },
    { ...helper, executionId: "bad-model", model: "" },
    { ...helper, executionId: "bad-outcome", outcome: "invented" },
    { ...helper, executionId: "invalid-counts", usage: { prompt_tokens: -1, completion_tokens: Infinity } },
  ]);
  assert.deepEqual(safe, [helper, { ...helper, executionId: "invalid-counts", usage: null }]);
  assert.deepEqual(readExecutionReceipts([helper], "other-operation"), []);
});

test("AA044 prepare 401 requires the same account and makes no inference call", async () => {
  const methods: string[] = [];
  await assert.rejects(prepareTurnId("/fixture/turn", {}, new AbortController().signal, async (_url, init) => {
    methods.push(init?.method ?? "");
    return new Response(null, { status: 401 });
  }), /Sign in to the same account.*No model was called/);
  assert.deepEqual(methods, ["GET"]);
});
