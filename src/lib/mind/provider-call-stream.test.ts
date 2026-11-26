import assert from "node:assert/strict";
import { test } from "node:test";
import { callConfiguredProvider, routeSelectedModel } from "./provider-call.ts";
import { configuredModelReadiness, modelTierCatalog, reconcileTierParams } from "./model-tiers.ts";

function delayedResponse(frames: string[], contentType: string) {
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  const encoder = new TextEncoder();
  return { release, response: new Response(new ReadableStream<Uint8Array>({ async start(controller) {
    controller.enqueue(encoder.encode(frames[0])); await blocked;
    for (const frame of frames.slice(1)) controller.enqueue(encoder.encode(frame)); controller.close();
  } }), { headers: { "content-type": contentType, "x-request-id": "fixture-request" } }) };
}
const sse = (value: unknown) => `data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`;
async function beforeRelease(run: (onDelta: (text: string) => void) => Promise<unknown>, release: () => void) {
  const chunks: string[] = []; let first!: () => void;
  const arrived = new Promise<void>(resolve => { first = resolve; });
  const running = run(text => { chunks.push(text); first(); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([arrived, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("First delta was buffered until completion")), 1000); })]); }
  finally { if (timer) clearTimeout(timer); release(); }
  assert.ok(chunks.length >= 1);
  return { result: await running, chunks };
}

test("configured OpenAI, Anthropic and Gemini forward the first of ten chunks before completion", async () => {
  for (const id of ["openai", "anthropic", "gemini"] as const) {
    const chunks = Array.from({ length: 10 }, (_, index) => `part${index} `);
    const frames = id === "anthropic"
      ? [sse({ type: "content_block_delta", delta: { type: "text_delta", text: chunks[0] } }), sse({ type: "message_start", message: { model: "actual", usage: { input_tokens: 12 } } }), ...chunks.slice(1).map(text => sse({ type: "content_block_delta", delta: { type: "text_delta", text } })), sse({ type: "message_delta", usage: { output_tokens: 10 } }), sse({ type: "message_stop" })]
      : id === "gemini"
        ? chunks.map((text, index) => sse({ modelVersion: "actual", candidates: [{ content: { parts: [{ text }] }, ...(index === 9 ? { finishReason: "STOP" } : {}) }], ...(index === 9 ? { usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 10 } } : {}) }))
        : [...chunks.map(text => sse({ model: "actual", choices: [{ delta: { content: text } }] })), sse({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 10 } }), sse("[DONE]")];
    const fake = delayedResponse(frames, "text/event-stream");
    const observed = await beforeRelease(onDelta => callConfiguredProvider({ id, key: "synthetic", prompt: "Fixture", onDelta, controls: { answerTokens: 2048 }, fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (id === "gemini") { assert.match(url, /:streamGenerateContent\?alt=sse$/); assert.equal(body.generationConfig.maxOutputTokens, 2048); }
      else { assert.equal(body.stream, true); assert.equal(body.max_tokens, 2048); }
      return fake.response;
    } }), fake.release);
    const result = observed.result as Awaited<ReturnType<typeof callConfiguredProvider>>;
    assert.equal(result.ok, true); assert.equal(result.delivery, "streamed"); assert.equal(result.model, "actual");
    assert.deepEqual(observed.chunks, chunks); assert.deepEqual(result.usage, { prompt_tokens: 12, completion_tokens: 10 });
  }
});

test("OpenRouter and Nemotron stream through their selected route and preserve final actual USD metadata", async () => {
  for (const id of ["openrouter", "nemotron"]) {
    const fake = delayedResponse([sse({ model: "actual-free", choices: [{ delta: { content: "first " } }] }), ...Array.from({ length: 9 }, () => sse({ choices: [{ delta: { content: "next " } }] })), sse({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 10, cost: 0, is_byok: false } }), sse("[DONE]")], "text/event-stream");
    const { result: raw, chunks } = await beforeRelease(onDelta => routeSelectedModel({ id, prompt: "Fixture", env: { OPENROUTER_API_KEY: "synthetic", OPENROUTER_MODEL: "fixture/model:free" }, onDelta, fetch: async (url, init) => { assert.match(url, /^https:\/\/openrouter.ai\//); assert.equal(JSON.parse(String(init?.body)).stream, true); return fake.response; } }), fake.release);
    const result = raw as Awaited<ReturnType<typeof routeSelectedModel>>;
    assert.equal(result.ok, true); assert.equal(result.delivery, "streamed"); assert.equal(chunks.length, 10);
    assert.equal(result.actualCostMicros, 0); assert.equal(result.currency, "USD"); assert.equal(result.requestId, "fixture-request");
  }
});

test("native Ollama forwards NDJSON answer chunks and fails an incomplete stream without success", async () => {
  const frames = [...Array.from({ length: 10 }, (_, index) => JSON.stringify({ model: "actual-local", response: `part${index} `, thinking: "private fixture reasoning", done: false }) + "\n"), JSON.stringify({ model: "actual-local", done: true, prompt_eval_count: 9, eval_count: 10 }) + "\n"];
  const fake = delayedResponse(frames, "application/x-ndjson");
  const { result: raw, chunks } = await beforeRelease(onDelta => routeSelectedModel({ id: "ollama", prompt: "Fixture", env: { LOCAL_MODEL_URL: "http://fixture.invalid/api/generate", OLLAMA_MODEL: "selected-local" }, onDelta, fetch: async (_url, init) => { const body = JSON.parse(String(init?.body)); assert.equal(body.stream, true); assert.equal(body.model, "selected-local"); return fake.response; } }), fake.release);
  const result = raw as Awaited<ReturnType<typeof routeSelectedModel>>;
  assert.equal(result.ok, true); assert.equal(result.delivery, "streamed"); assert.equal(chunks.length, 10); assert.equal(chunks.join("").includes("private"), false);
  assert.deepEqual(result.usage, { prompt_tokens: 9, completion_tokens: 10 });
  const broken = await routeSelectedModel({ id: "ollama", prompt: "Fixture", env: { LOCAL_MODEL_URL: "http://fixture.invalid/api/generate" }, onDelta: () => {}, fetch: async () => new Response(frames[0], { headers: { "content-type": "application/x-ndjson" } }) });
  assert.equal(broken.ok, false); assert.equal(broken.text, "");
});

test("buffered adapters are labeled and charged receipts survive a broken selected provider stream", async () => {
  const buffered = await routeSelectedModel({ id: "ollama", prompt: "Fixture", env: { LOCAL_MODEL_URL: "http://fixture.invalid/legacy" }, onDelta: () => {}, fetch: async (_url, init) => { assert.equal(JSON.parse(String(init?.body)).stream, undefined); return Response.json({ text: "Buffered", model: "actual" }); } });
  assert.equal(buffered.ok, true); assert.equal(buffered.delivery, "buffered");
  const broken = await callConfiguredProvider({ id: "openrouter", key: "synthetic", model: "fixture/model:free", prompt: "Fixture", onDelta: () => {}, fetch: async () => new Response(sse({ choices: [], usage: { prompt_tokens: 10, cost: 0.002, is_byok: false } }), { headers: { "content-type": "text/event-stream" } }) });
  assert.equal(broken.ok, false); assert.equal(broken.actualCostMicros, 2000); assert.equal(broken.usage?.prompt_tokens, 10);
});

test("configured model names are never inference proof and explicit overrides drop unsupported reasoning", () => {
  assert.deepEqual(configuredModelReadiness("fixture-absent", ["fixture-present"]), { verifiedInference: false, availability: "unavailable" });
  assert.equal(modelTierCatalog({ MIND_MODEL_HEAVY: "fixture-absent" }, ["fixture-present"]).find(row => row.id === "Heavy")?.availability, "unavailable");
  assert.equal(modelTierCatalog({ MIND_MODEL_HEAVY: "fixture-absent" }).find(row => row.id === "Heavy")?.verifiedInference, false);
  assert.deepEqual(reconcileTierParams("grok-4.3", { temperature: 0.2, max_tokens: 800, reasoning_effort: "high" }), { temperature: 0.2, max_tokens: 800 });
});
