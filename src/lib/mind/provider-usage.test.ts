import assert from "node:assert/strict";
import { test } from "node:test";
import { readProviderReceipt } from "./provider-usage.ts";
import { callConfiguredProvider, routeSelectedModel } from "./provider-call.ts";

test("provider receipts preserve reported token counts and distinguish request and response IDs", () => {
  const headers = new Headers({ "x-request-id": "request-fixture" });
  assert.deepEqual(readProviderReceipt("openai", { id: "completion-fixture", usage: { prompt_tokens: 19, completion_tokens: 0, total_tokens: 19, prompt_tokens_details: { cached_tokens: 8 }, completion_tokens_details: { reasoning_tokens: 0 } } }, headers), {
    usage: { prompt_tokens: 19, completion_tokens: 0, total_tokens: 19, cached_input_tokens: 8, reasoning_tokens: 0 }, requestId: "request-fixture", responseId: "completion-fixture",
  });
  assert.deepEqual(readProviderReceipt("anthropic", { id: "msg_fixture", usage: { input_tokens: 11, output_tokens: 8, cache_read_input_tokens: 20, cache_creation_input_tokens: 9 } }, new Headers({ "request-id": "request-claude" })), {
    usage: { prompt_tokens: 11, completion_tokens: 8, cached_input_tokens: 20, cache_creation_input_tokens: 9 }, requestId: "request-claude", responseId: "msg_fixture",
  });
  assert.deepEqual(readProviderReceipt("gemini", { responseId: "gemini-response", usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 8, totalTokenCount: 45, cachedContentTokenCount: 5, thoughtsTokenCount: 7 } }), {
    usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 45, cached_input_tokens: 5, reasoning_tokens: 7 }, requestId: null, responseId: "gemini-response",
  });
  assert.deepEqual(readProviderReceipt("ollama", { prompt_eval_count: 7, eval_count: 12 }), { usage: { prompt_tokens: 7, completion_tokens: 12 }, requestId: null, responseId: null });
});

test("missing or malformed usage stays unknown rather than zero, totals are not inferred", () => {
  for (const payload of [null, {}, [], { usage: {} }, { usage: { prompt_tokens: "12", completion_tokens: -1, total_tokens: Number.POSITIVE_INFINITY } }]) {
    assert.equal(readProviderReceipt("openai", payload).usage, null);
  }
  assert.deepEqual(readProviderReceipt("openrouter", { usage: { prompt_tokens: 5, completion_tokens: 3 } }).usage, { prompt_tokens: 5, completion_tokens: 3 });
  assert.equal(readProviderReceipt("openai", { id: "id\ninjected", request_id: "Bearer fixture" }).responseId, null);
  assert.equal(readProviderReceipt("openai", { request_id: "Bearer fixture" }).requestId, null);
});

test("all configured env adapters return usage and apply only an explicitly selected answer limit", async () => {
  for (const id of ["openai", "openrouter", "anthropic", "gemini"] as const) {
    for (const answerTokens of [undefined, 4096]) {
      const result = await callConfiguredProvider({ id, key: "fixture", model: id === "openrouter" ? "fixture/model:free" : undefined, prompt: "Fixture", controls: answerTokens === undefined ? undefined : { answerTokens, reasoning: "high" }, fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        if (id === "gemini") assert.equal(request.generationConfig?.maxOutputTokens, answerTokens);
        else assert.equal(request.max_tokens, answerTokens ?? (id === "anthropic" ? 400 : undefined));
        assert.equal(request.reasoning_effort, undefined);
        const payload = id === "gemini" ? { modelVersion: "fixture", candidates: [{ content: { parts: [{ text: "Gemini" }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 9 } }
          : id === "anthropic" ? { model: "fixture", content: [{ type: "text", text: "Claude" }], usage: { input_tokens: 12, output_tokens: 9 } }
            : { model: "fixture", choices: [{ message: { content: "Reply" } }], usage: { prompt_tokens: 12, completion_tokens: 9 } };
        return Response.json(payload, { headers: { "x-request-id": `request-${id}` } });
      } });
      assert.equal(result.ok, true); assert.deepEqual(result.usage, { prompt_tokens: 12, completion_tokens: 9 }); assert.equal(result.requestId, `request-${id}`);
    }
  }
});

test("Nemotron forwards controls and usage without switching provider", async () => {
  const result = await routeSelectedModel({ id: "nemotron", env: { OPENROUTER_API_KEY: "fixture" }, prompt: "Fixture", controls: { answerTokens: 2048 }, fetch: async (url, init) => {
    assert.match(url, /openrouter/); assert.equal(JSON.parse(String(init?.body)).max_tokens, 2048);
    return Response.json({ choices: [{ message: { content: "Fixture" } }], usage: { prompt_tokens: 2, completion_tokens: 3 } });
  } });
  assert.deepEqual(result.usage, { prompt_tokens: 2, completion_tokens: 3 }); assert.equal(result.requestId, null);
});

test("native Ollama budget uses num_predict and accepts its reported counts; custom runners refuse unknown controls", async () => {
  let calls = 0;
  const send = async (path: string, answerTokens?: number) => routeSelectedModel({ id: "ollama", env: { LOCAL_MODEL_URL: `http://localhost:11434${path}` }, prompt: "Fixture", controls: answerTokens === undefined ? undefined : { answerTokens }, fetch: async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    if (path === "/api/generate") { assert.equal(body.options?.num_predict, answerTokens); assert.equal(body.stream, false); }
    else assert.equal(body.options, undefined);
    return Response.json(path === "/api/generate" ? { model: "fixture", response: "Native reply", prompt_eval_count: 7, eval_count: 4 } : { text: "Legacy reply" });
  } });
  assert.equal((await send("/generate", 400)).ok, false); assert.equal(calls, 0);
  const native = await send("/api/generate", 400); assert.equal(native.text, "Native reply"); assert.deepEqual(native.usage, { prompt_tokens: 7, completion_tokens: 4 });
  assert.equal((await send("/generate")).usage, null); assert.equal(calls, 2);
});

test("invalid requested output budgets stop before provider dispatch and failed content retains actual usage", async () => {
  let calls = 0;
  const fetch = async () => { calls++; return Response.json({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 0 } }); };
  const invalid = await callConfiguredProvider({ id: "openai", key: "fixture", prompt: "Fixture", controls: { answerTokens: 20000 }, fetch });
  assert.equal(invalid.ok, false); assert.equal(calls, 0);
  const failed = await callConfiguredProvider({ id: "openai", key: "fixture", prompt: "Fixture", fetch });
  assert.equal(failed.ok, false); assert.deepEqual(failed.usage, { prompt_tokens: 5, completion_tokens: 0 }); assert.equal(calls, 1);
});


test("OpenRouter exposes only its reported USD credit cost, without deriving money from token counts", () => {
  for (const [cost, expected] of [[0, 0], [0.000001, 1], [0.000123, 123], [0.95, 950000], [1000000, 1000000000000]]) {
    const receipt = readProviderReceipt("openrouter", { usage: { cost, prompt_tokens: 99, is_byok: false } });
    assert.equal(receipt.actualCostMicros, expected); assert.equal(receipt.reportedCostUsd, cost);
    assert.equal(receipt.currency, "USD"); assert.equal(receipt.costScope, "openrouter_credits");
  }
  for (const cost of [undefined, null, "0", -1, NaN, Infinity, 1000001]) {
    const receipt = readProviderReceipt("openrouter", { usage: { cost } });
    assert.equal(receipt.actualCostMicros, undefined); assert.equal(receipt.reportedCostUsd, undefined);
  }
  for (const protocol of ["openai", "anthropic", "gemini", "ollama"] as const) assert.equal(readProviderReceipt(protocol, { usage: { cost: 0.95 } }).actualCostMicros, undefined);
  assert.equal(readProviderReceipt("openrouter", { usage: { prompt_tokens: 1000000 } }).actualCostMicros, undefined);
});

test("submicro cost and BYOK retain known router charge but cannot release a complete-cost reservation", () => {
  for (const cost of [0.0000001, 0.0000019, 0.30000000000000004]) {
    const receipt = readProviderReceipt("openrouter", { usage: { cost } });
    assert.equal(receipt.reportedCostUsd, cost); assert.equal(receipt.actualCostMicros, undefined);
  }
  const byok = readProviderReceipt("openrouter", { usage: { cost: 0, is_byok: true, cost_details: { upstream_inference_cost: 0.2 } } });
  assert.equal(byok.reportedCostUsd, 0); assert.equal(byok.actualCostMicros, undefined);
});

test("configured OpenRouter returns real cost even when the completion is unusable", async () => {
  const result = await callConfiguredProvider({ id: "openrouter", model: "fixture/model:free", key: "fixture", prompt: "Fixture", fetch: async () => Response.json({ id: "response-fixture", choices: [], usage: { cost: 0.000123, is_byok: false } }) });
  assert.equal(result.ok, false); assert.equal(result.actualCostMicros, 123); assert.equal(result.currency, "USD");
});
