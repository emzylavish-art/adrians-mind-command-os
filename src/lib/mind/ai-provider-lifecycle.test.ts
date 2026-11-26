import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sql } from "../db.ts";
import { discoverAiModels, executeCustomChat, rotateAiProviderKey, validateCustomProviderSelection, aiProviderSpeechCredential } from "./ai-provider-config.server.ts";

const id = "11111111-1111-4111-8111-111111111111";
function fixture(overrides: Record<string, unknown> = {}) {
  const row = { id, label: "Fixture", base_url: "https://api.openai.com/v1", key_ciphertext: "fake-ciphertext", default_model: "chosen", models: ["chosen"], status: "catalogued", last_error: "", ...overrides };
  const updates: { query: string; params: unknown[] }[] = [];
  const sql = { query: async <T>(query: string, params: unknown[] = []) => {
    if (query.startsWith("select")) return (params[0] === "owner" ? [row] : []) as T[];
    updates.push({ query, params });
    return [{ ...row, key_ciphertext: params[2], status: params[3] }] as T[];
  } } as unknown as Sql;
  return { row, sql, updates, decrypt: () => "synthetic-key" };
}

test("failed discovery is a failed catalogue stage, and disappearing models preserve selection", async () => {
  const f = fixture();
  const failed = await discoverAiModels("owner", id, { ...f, request: async () => ({ status: 401, text: "", requestId: null }) });
  assert.equal(failed.ok, false); assert.equal(failed.stage, "catalogue"); assert.equal(failed.provider?.status, "credentials_rejected");
  const refreshed = await discoverAiModels("owner", id, { ...f, request: async () => ({ status: 200, text: JSON.stringify({ data: [{ id: "replacement" }] }), requestId: null }) });
  assert.equal(refreshed.provider?.defaultModel, "chosen"); assert.equal(refreshed.provider?.selectedModelAvailable, false); assert.equal(refreshed.provider?.inferenceVerifiedAt, null);
});

test("preflight rejects deleted, wrong-account or unavailable models without requesting providers", async () => {
  const f = fixture(); let calls = 0;
  const deps = { ...f, request: async () => { calls++; return { status: 200, text: "", requestId: null }; } };
  assert.equal((await validateCustomProviderSelection("other", { id, model: "chosen" }, deps)).ok, false);
  assert.equal((await validateCustomProviderSelection("owner", { id, model: "removed" }, deps)).ok, false);
  assert.equal((await executeCustomChat("owner", { id, model: "removed" }, [{ role: "user", content: "hi" }], undefined, deps)).ok, false);
  assert.equal(calls, 0);
});

test("only a successful inference records inference proof and 429 records a bounded model cooldown", async () => {
  const f = fixture();
  const limited = await executeCustomChat("owner", { id, model: "chosen" }, [{ role: "user", content: "hi" }], undefined, { ...f, request: async () => ({ status: 429, text: "", requestId: null, retryAfter: "30" }) });
  assert.equal(limited.ok, false); assert.equal(f.updates.at(-1)?.params[2], "rate_limited"); assert.equal(f.updates.at(-1)?.params[5], "chosen");
  const success = await executeCustomChat("owner", { id, model: "chosen" }, [{ role: "user", content: "hi" }], undefined, { ...f, request: async () => ({ status: 200, text: JSON.stringify({ model: "actual", choices: [{ message: { content: "answer" } }] }), requestId: "fixture-request" }) });
  assert.equal(success.ok, true); assert.match(f.updates.at(-1)!.query, /inference_verified_at=now/); assert.equal(f.updates.at(-1)?.params[2], "actual");
});

test("credential rotation preserves connection id and clears previous inference evidence", async t => {
  const prior = process.env.CONNECTOR_TOKEN_SECRET; process.env.CONNECTOR_TOKEN_SECRET = "synthetic-regression-secret";
  t.after(() => { if (prior === undefined) delete process.env.CONNECTOR_TOKEN_SECRET; else process.env.CONNECTOR_TOKEN_SECRET = prior; });
  const f = fixture();
  const rotated = await rotateAiProviderKey("owner", id, "synthetic-new-key", f);
  assert.equal(rotated.ok, true); if (rotated.ok) assert.equal(rotated.provider.id, id);
  assert.match(f.updates.at(-1)!.query, /inference_verified_at=null/);
  assert.notEqual(f.updates.at(-1)?.params[2], "synthetic-new-key");
});

test("speech credential selection permits only matching owner and implemented official audio hosts", async () => {
  assert.equal((await aiProviderSpeechCredential("other", id, fixture())).ok, false);
  assert.equal((await aiProviderSpeechCredential("owner", id, fixture({ base_url: "https://generativelanguage.googleapis.com/v1beta" }))).ok, false);
  const selected = await aiProviderSpeechCredential("owner", id, fixture());
  assert.equal(selected.ok, true); if (selected.ok) assert.equal(selected.provider, "openai");
});

test("unknown or text-only model images fail before dispatch; capable streams preserve real deltas", async () => {
  const image = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=" };
  const f = fixture(); let calls = 0;
  const unknown = await executeCustomChat("owner", { id, model: "chosen" }, [{ role: "user", content: "image" }], undefined, { ...f, options: { images: [image] }, request: async () => { calls++; return { status: 200, text: "", requestId: null }; } });
  assert.equal(unknown.ok, false); assert.equal(calls, 0);
  const capable = fixture({ model_capabilities: { chosen: { imageInput: "supported", source: "catalogue", reasoningLevels: [] } } });
  const chunks: string[] = [];
  const result = await executeCustomChat("owner", { id, model: "chosen" }, [{ role: "user", content: "image" }], undefined, { ...capable, options: { images: [image] }, onDelta: text => chunks.push(text), request: async (_row, _path, init, stream) => {
    assert.equal(JSON.parse(String(init.body)).stream, true);
    assert.equal(JSON.parse(String(init.body)).messages[0].content[1].image_url.url, image.dataUrl);
    stream!.onDelta("first "); stream!.onDelta("second");
    return { status: 200, text: "", requestId: "fixture", answer: { ok: true, text: "first second", model: "actual", usage: null } };
  } });
  assert.equal(result.ok, true); assert.deepEqual(chunks, ["first ", "second"]);
});

test("declared output caps reject an incompatible selected budget before helpers or inference", async () => {
  const f = fixture({ model_capabilities: { chosen: { imageInput: "unknown", source: "unknown", reasoningLevels: [], maxOutputTokens: 2048, contextWindowTokens: 8192, limitsSource: "catalogue" } } });
  let calls = 0;
  const deps = { ...f, options: { controls: { answerTokens: 4096 } }, request: async () => { calls++; return { status: 200, text: "", requestId: null }; } };
  assert.equal((await validateCustomProviderSelection("owner", { id, model: "chosen" }, deps)).ok, false);
  assert.equal((await executeCustomChat("owner", { id, model: "chosen" }, [{ role: "user", content: "Fixture" }], undefined, deps)).ok, false);
  const accepted = await validateCustomProviderSelection("owner", { id, model: "chosen" }, { ...deps, options: { controls: { answerTokens: 1024 } } });
  assert.equal(accepted.ok, true); if (accepted.ok) assert.equal(accepted.capabilities?.contextWindowTokens, 8192);
  assert.equal(calls, 0);
});

test("custom providers retain observed usage and exact router charges when no answer completes", async () => {
  const f = fixture({ base_url: "https://openrouter.ai/api/v1", default_model: "fixture/model:free", models: ["fixture/model:free"] });
  const selection = { id, model: "fixture/model:free" };
  for (const response of [
    { status: 200, requestId: "charged-empty", text: JSON.stringify({ id: "response-empty", model: "observed-model", choices: [], usage: { prompt_tokens: 20, completion_tokens: 0, cost: 0.00125 } }) },
    { status: 200, requestId: "charged-stream", text: "", answer: { ok: false as const, error: "Stream incomplete" }, observedModel: "observed-model", receipt: { usage: { prompt_tokens: 20, completion_tokens: 0 }, requestId: "charged-stream", responseId: "response-stream", actualCostMicros: 1250, currency: "USD" as const } },
    { status: 503, requestId: "charged-failure", text: JSON.stringify({ id: "response-failure", model: "observed-model", error: { message: "Failure after provider processing" }, usage: { prompt_tokens: 20, completion_tokens: 0, cost: 0.00125 } }) },
  ]) {
    const result = await executeCustomChat("owner", selection, [{ role: "user", content: "Fixture" }], undefined, { ...f, request: async () => response });
    assert.equal(result.ok, false); assert.equal(result.provider, "Fixture"); assert.equal(result.model, "observed-model");
    assert.deepEqual(result.usage, { prompt_tokens: 20, completion_tokens: 0 }); assert.equal(result.requestId, response.requestId);
    assert.equal(result.actualCostMicros, 1250); assert.equal(result.currency, "USD");
    assert.ok(!f.updates.some(update => update.query.includes("inference_verified_at=now")));
  }
});

test("custom failure bookkeeping outages preserve provider receipts and do not invent dollar costs", async () => {
  const f = fixture();
  const sql = { query: async <T>(query: string) => { if (query.startsWith("select")) return [f.row] as T[]; throw new Error("Synthetic bookkeeping outage"); } } as unknown as Sql;
  const result = await executeCustomChat("owner", { id, model: "chosen" }, [{ role: "user", content: "Fixture" }], undefined, { ...f, sql,
    request: async () => ({ status: 503, requestId: "provider-request", text: JSON.stringify({ usage: { prompt_tokens: 9, cost: 0.1 } }) }) });
  assert.equal(result.ok, false); assert.equal(result.requestId, "provider-request"); assert.deepEqual(result.usage, { prompt_tokens: 9 });
  assert.equal(result.actualCostMicros, undefined); assert.equal(result.currency, undefined);
});
