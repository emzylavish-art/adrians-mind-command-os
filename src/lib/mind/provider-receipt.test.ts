import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callConfiguredProvider, routeSelectedModel } from "./provider-call.ts";
import { normalizeProviderReceipt } from "./provider-receipt.ts";
import { collectConsultHelp, type ConsultExecutionReceipt, type ConsultPlan } from "./model-consult.ts";
import { invokeProviderRouter } from "./logic-route-adapter.server.ts";
import { modelGenerateArgs } from "./logic-routes.ts";
import { emptyWorkspace, normalizeWorkspace, packWorkspace, unpackWorkspace } from "./workspace.ts";

describe("C4 provider execution receipts", () => {
  it("passes provider-reported usage and identity through OpenAI, Anthropic, Gemini and OpenRouter", async () => {
    for (const provider of ["openai", "anthropic", "gemini", "openrouter"] as const) {
      const payload = provider === "anthropic" ? { model: "actual", content: [{ type: "text", text: "reply" }], usage: { input_tokens: 11, output_tokens: 7 } }
        : provider === "gemini" ? { modelVersion: "actual", candidates: [{ content: { parts: [{ text: "reply" }] } }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 } }
        : { model: "actual", choices: [{ message: { content: "reply" } }], usage: { prompt_tokens: 11, completion_tokens: 7 } };
      const result = await callConfiguredProvider({ id: provider, model: provider === "openrouter" ? "provider/requested:free" : "requested", key: "fixture", prompt: "hello",
        fetch: async () => Response.json(payload, { headers: { "x-request-id": "request-123" } }) });
      assert.equal(result.ok, true);
      assert.equal(result.model, "actual");
      assert.deepEqual(result.usage, { prompt_tokens: 11, completion_tokens: 7 });
      assert.equal(result.requestId, "request-123");
      assert.equal(result.executionLocation, "hosted");
    }
  });

  it("keeps missing and invalid counters unknown while preserving a valid zero", () => {
    assert.deepEqual(normalizeProviderReceipt("openai", {}), { usage: null, requestId: null, executionLocation: "hosted" });
    assert.deepEqual(normalizeProviderReceipt("openai", { usage: { prompt_tokens: -1, completion_tokens: 0 } }).usage, { completion_tokens: 0 });
    assert.equal(normalizeProviderReceipt("openai", { usage: { prompt_tokens: "20", completion_tokens: 1.5 } }).usage, null);
  });

  it("preserves an error response's available receipt without fabricating success", async () => {
    const result = await callConfiguredProvider({ id: "openai", key: "fixture", prompt: "hello",
      fetch: async () => Response.json({ model: "failed-upstream-model", usage: { prompt_tokens: 8 } }, { status: 500, headers: { "x-request-id": "failed-request" } }) });
    assert.equal(result.ok, false); assert.equal(result.dispatched, true);
    assert.deepEqual(result.usage, { prompt_tokens: 8 }); assert.equal(result.requestId, "failed-request");
    assert.equal(result.model, "failed-upstream-model");
  });

  it("retains OpenRouter route metadata and distinguishes local Ollama usage", async () => {
    const routed = await routeSelectedModel({ id: "openrouter", prompt: "hello", env: { OPENROUTER_API_KEY: "fixture", OPENROUTER_MODEL: "vendor/request:free" },
      fetch: async () => Response.json({ id: "generation-id", model: "actual", usage: { prompt_tokens: 1, completion_tokens: 2 }, choices: [{ message: { content: "reply" } }] }) });
    assert.equal(routed.requestedModel, "vendor/request:free"); assert.equal(routed.model, "actual");
    assert.equal(routed.requestId, "generation-id"); assert.deepEqual(routed.usage, { prompt_tokens: 1, completion_tokens: 2 });
    const local = await routeSelectedModel({ id: "ollama", prompt: "hello", env: { LOCAL_MODEL_URL: "http://fixture.invalid", OLLAMA_MODEL: "requested" },
      fetch: async () => Response.json({ model: "actual-local", response: "reply", prompt_eval_count: 5, eval_count: 3 }) });
    assert.equal(local.executionLocation, "local"); assert.equal(local.requestedModel, "requested");
    assert.deepEqual(local.usage, { prompt_tokens: 5, completion_tokens: 3 });
  });

  it("preserves normalized Python adapter receipts instead of replacing them with null", async () => {
    const result = await invokeProviderRouter({ spec: modelGenerateArgs("sol", [{ role: "user", content: "hello" }], "requested"), env: {},
      spawnImpl: async () => ({ code: 0, stderr: "", timedOut: false, stdout: JSON.stringify({ provider: "sol", model: "actual", content: "reply", usage: { prompt_tokens: 10 }, request_id: "adapter-id" }) }) });
    assert.equal(result.ok, true);
    if (result.ok) { assert.deepEqual(result.usage, { prompt_tokens: 10 }); assert.equal(result.requestId, "adapter-id"); }
  });

  it("retains failed Python and local runner metadata while distinguishing preflight rejection", async () => {
    const spec = modelGenerateArgs("sol", [{ role: "user", content: "hello" }], "selected");
    const failed = await invokeProviderRouter({ spec, env: {}, spawnImpl: async () => ({ code: 2, stdout: "", timedOut: false,
      stderr: JSON.stringify({ error: "Provider returned HTTP 500.", provider: "sol", dispatched: true, model: "failed-model", requested_model: "selected", request_id: "failed-id", usage: { prompt_tokens: 8 } }) }) });
    assert.equal(failed.ok, false); assert.equal(failed.dispatched, true);
    assert.equal(failed.model, "failed-model"); assert.equal(failed.requestId, "failed-id");
    assert.deepEqual(failed.usage, { prompt_tokens: 8 });
    const preflight = await invokeProviderRouter({ spec, env: {}, spawnImpl: async () => ({ code: 2, stdout: "", timedOut: false, stderr: JSON.stringify({ error: "Budget preflight failed.", dispatched: false }) }) });
    assert.equal(preflight.ok, false); assert.equal(preflight.dispatched, false);
    const local = await routeSelectedModel({ id: "ollama", prompt: "hello", env: { LOCAL_MODEL_URL: "http://fixture.invalid", OLLAMA_MODEL: "selected" },
      fetch: async () => Response.json({ model: "failed-local", prompt_eval_count: 9, id: "local-error" }, { status: 500 }) });
    assert.equal(local.ok, false); assert.equal(local.dispatched, true);
    assert.equal(local.model, "failed-local"); assert.equal(local.requestId, "local-error");
    assert.deepEqual(local.usage, { prompt_tokens: 9 });
    assert.equal(local.executionLocation, "local");
  });

  it("records successful and failed helper executions, skips undispatched helpers and uses stable child identities", async () => {
    const plan: ConsultPlan = { orchestrator: "grok", available: ["openai", "gemini", "anthropic"], purpose: "synthesize", helpers: ["openai", "gemini", "anthropic"].map((id) => ({ id, request: "fixture" })) };
    const receipts: ConsultExecutionReceipt[] = [];
    const run = () => collectConsultHelp(plan, async (id) => id === "anthropic" ? { ok: false, text: "", dispatched: false }
      : { ok: id === "openai", text: id === "openai" ? "help" : "", model: `${id}-actual`, requestedModel: `${id}-requested`, usage: { prompt_tokens: 4 }, requestId: `${id}-request` },
    { parentOperationId: "parent-operation", onReceipt: (receipt) => { receipts.push(receipt); } });
    assert.deepEqual(await run(), [{ id: "openai", text: "help" }]);
    assert.deepEqual(receipts.map((row) => [row.executionId, row.outcome]), [["parent-operation:helper:0", "completed"], ["parent-operation:helper:1", "failed"]]);
    await run(); assert.equal(receipts[0].executionId, receipts[2].executionId);
  });

  it("retains execution provenance across reload and archive import without converting unknown counters to zero", async () => {
    const workspace = emptyWorkspace();
    workspace.usage = [{ id: "parent:helper:0", chatId: "chat", at: "2026-01-01T00:00:00.000Z", provider: "ollama", model: "actual",
      requestedModel: "selected", requestId: "request", promptTokens: 0, completionTokens: null, kind: "partial",
      operationId: "parent", role: "helper", outcome: "failed", executionLocation: "local" }];
    const loaded = normalizeWorkspace(JSON.parse(JSON.stringify(workspace)));
    assert.deepEqual(loaded.usage, workspace.usage);
    const archive = await packWorkspace(loaded, true);
    const opened = await unpackWorkspace(JSON.stringify(archive));
    assert.equal(opened.ok, true);
    if (opened.ok) assert.deepEqual(opened.workspace.usage, workspace.usage);
    const invalid = normalizeWorkspace({ ...workspace, usage: [{ ...workspace.usage[0], promptTokens: -1, completionTokens: 0.5 }] });
    assert.equal(invalid.usage[0].promptTokens, null);
    assert.equal(invalid.usage[0].completionTokens, null);
    assert.equal(invalid.usage[0].kind, "unknown");
  });

  it("keeps a thrown helper execution unknown and does not turn a pre-dispatch rejection into usage", async () => {
    const receipts: ConsultExecutionReceipt[] = [];
    const result = await collectConsultHelp({ orchestrator: "grok", available: ["openai", "gemini"], purpose: "synthesize", helpers: [{ id: "openai", request: "fixture" }, { id: "gemini", request: "fixture" }] },
      async (id) => { if (id === "openai") throw new Error("connection lost after dispatch"); return { ok: false, text: "", dispatched: false }; },
      { parentOperationId: "operation", onReceipt: (receipt) => { receipts.push(receipt); } });
    assert.deepEqual(result, []);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].outcome, "unknown");
    assert.equal(receipts[0].usage, null);
    assert.equal(receipts[0].model, "model unknown");
    let fetches = 0;
    const stopped = new AbortController(); stopped.abort();
    const configured = await callConfiguredProvider({ id: "openai", key: "fixture", prompt: "fixture", signal: stopped.signal,
      fetch: async () => { fetches++; return Response.json({}); } });
    assert.equal(configured.dispatched, false);
    assert.equal(fetches, 0);
  });
});
