import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide } from "./policy.ts";
import { resolveModelTier } from "./model-tiers.ts";
import { buildRelayModelBody, relayModelStream, STOPPED_REPLY } from "./relay.ts";
import { pullMindEvents } from "./stream.ts";

const encoder = new TextEncoder();

async function readAll(response: Response) {
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    raw += decoder.decode(step.value);
  }
  return raw;
}

describe("provider relay", () => {
  it("forwards a finished stream and does not cancel the provider", async () => {
    const incoming = new AbortController();
    let seen: AbortSignal | undefined;
    let canceled = false;
    const response = relayModelStream({
      apiKey: "test-key",
      model: "grok-4.5",
      messages: [{ role: "user", content: "Hi" }],
      usedIds: ["n1"],
      requestSignal: incoming.signal,
      timeoutMs: 5_000,
      fetchImpl: async (_url, init) => {
        seen = init?.signal ?? undefined;
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), "Bearer test-key");
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n'));
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"lo"}}]}\n'));
              controller.enqueue(encoder.encode("data: [DONE]\n"));
              controller.close();
            },
            cancel() {
              canceled = true;
            },
          }),
          { status: 200, headers: { "x-request-id": "req-1" } },
        );
      },
    });
    const raw = await readAll(response);
    assert.equal(seen?.aborted, false);
    assert.equal(canceled, false);
    assert.equal(raw.includes("event: canceled"), false);
    const done = pullMindEvents(raw).events.find((event) => event.event === "done");
    assert.equal(done?.event, "done");
    if (done?.event === "done") {
      assert.equal(done.text, "Hello");
      assert.deepEqual(done.usedIds, ["n1"]);
    }
  });

  it("aborts the provider request when the caller cancels and does not finish the reply", async () => {
    const incoming = new AbortController();
    let providerSignal: AbortSignal | undefined;
    let readerCanceled = false;
    const response = relayModelStream({
      apiKey: "test-key",
      model: "grok-4.5",
      messages: [{ role: "user", content: "Hi" }],
      usedIds: [],
      requestSignal: incoming.signal,
      timeoutMs: 10_000,
      fetchImpl: async (_url, init) => {
        providerSignal = init?.signal ?? undefined;
        const signal = providerSignal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
            },
            pull() {
              return new Promise<void>((resolve) => {
                if (!signal || signal.aborted) resolve();
                else signal.addEventListener("abort", () => resolve(), { once: true });
              });
            },
            cancel() {
              readerCanceled = true;
            },
          }),
          { status: 200 },
        );
      },
    });
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    assert.match(decoder.decode(first.value), /Hi/);
    incoming.abort();
    let raw = decoder.decode(first.value);
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      raw += decoder.decode(step.value);
    }
    assert.equal(providerSignal?.aborted, true);
    assert.equal(readerCanceled, true);
    assert.match(raw, /event: canceled/);
    assert.equal(raw.includes("event: done"), false);
    const canceled = pullMindEvents(raw).events.find((event) => event.event === "canceled");
    assert.equal(canceled?.event, "canceled");
    if (canceled?.event === "canceled") assert.equal(canceled.error, STOPPED_REPLY);
  });

  it("aborts the provider when the response reader is canceled", async () => {
    const incoming = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const response = relayModelStream({
      apiKey: "test-key",
      model: "grok-4.5",
      messages: [{ role: "user", content: "Hi" }],
      usedIds: [],
      requestSignal: incoming.signal,
      timeoutMs: 10_000,
      fetchImpl: async (_url, init) => {
        providerSignal = init?.signal ?? undefined;
        const signal = providerSignal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
            },
            pull() {
              return new Promise<void>((resolve) => {
                if (!signal || signal.aborted) resolve();
                else signal.addEventListener("abort", () => resolve(), { once: true });
              });
            },
          }),
          { status: 200 },
        );
      },
    });
    assert.ok(response.body);
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    assert.equal(providerSignal?.aborted, true);
  });

  it("reports a provider failure without a finished reply", async () => {
    const response = relayModelStream({
      apiKey: "test-key",
      model: "grok-4.5",
      messages: [{ role: "user", content: "Hi" }],
      usedIds: [],
      requestSignal: new AbortController().signal,
      timeoutMs: 5_000,
      fetchImpl: async () => new Response("no", { status: 503 }),
    });
    const raw = await readAll(response);
    assert.match(raw, /event: error/);
    assert.match(raw, /503/);
    assert.equal(raw.includes("event: done"), false);
  });

  it("keeps emergency stop separate from stopping one reply", () => {
    assert.equal(decide({ autonomy: "ask", kind: "chat", halted: true, approvalToken: null, expectedToken: null }).decision, "deny");
    assert.equal(STOPPED_REPLY.includes("Emergency stop"), false);
  });
});


describe("relay model body follows model tiers", () => {
  it("emits a different model id for each concrete tier in the provider JSON", async () => {
    const seen = new Set<string>();
    for (const tier of ["Fast", "Expert", "Heavy", "Build"] as const) {
      const resolved = resolveModelTier(tier, "probe", {});
      const captured: { body: { model?: string } | null } = { body: null };
      const response = relayModelStream({
        apiKey: "test-key",
        model: resolved.model,
        messages: [{ role: "user", content: "probe" }],
        usedIds: [],
        requestSignal: new AbortController().signal,
        params: {
          temperature: resolved.params.temperature,
          max_tokens: resolved.params.max_tokens,
          reasoning_effort: resolved.params.reasoning_effort,
        },
        meta: { modelTier: resolved.selected, resolvedTier: resolved.resolved, tierReason: resolved.reason },
        fetchImpl: async (_url, init) => {
          captured.body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n'));
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
                controller.close();
              },
            }),
            { status: 200 },
          );
        },
      });
      await response.text();
      assert.equal(captured.body?.model, resolved.model);
      seen.add(String(captured.body?.model));
      const fields = buildRelayModelBody(resolved.model, [{ role: "user", content: "probe" }], {
        temperature: resolved.params.temperature,
        max_tokens: resolved.params.max_tokens,
        reasoning_effort: resolved.params.reasoning_effort,
      });
      assert.equal(fields.model, resolved.model);
    }
    assert.equal(seen.size, 4);
  });
});
