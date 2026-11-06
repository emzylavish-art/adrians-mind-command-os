import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { handleRequest, usageFrom } from "./index.js";

const env = { MCP_AUTH_TOKEN: "test-token", OPENAI_API_KEY: "sk-test-secret", OPENAI_MODEL: "gpt-test" };

function call(method, body, headers = {}, withEnv = env) {
  return handleRequest(
    new Request("https://adrians-mind-mcp-tools.operation-beat-magnus.workers.dev/mcp", {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    }),
    withEnv,
    { fetchImpl: headers.fetchImpl },
  );
}

describe("adrians-mind-mcp-tools worker", () => {
  it("health is public and does not reveal secret values", async () => {
    const response = await handleRequest(new Request("https://example.workers.dev/health"), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.worker, "adrians-mind-mcp-tools");
    assert.equal(body.live_verified, false);
    assert.equal(body.auth_configured, true);
    assert.equal(JSON.stringify(body).includes("sk-test-secret"), false);
    assert.equal(JSON.stringify(body).includes("test-token"), false);
  });

  it("rejects missing and wrong bearer tokens with 401 and does not call OpenAI", async () => {
    let called = 0;
    const fetchImpl = async () => {
      called += 1;
      throw new Error("should not fetch");
    };
    const missing = await handleRequest(
      new Request("https://example.workers.dev/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
      { fetchImpl },
    );
    assert.equal(missing.status, 401);
    const wrong = await handleRequest(
      new Request("https://example.workers.dev/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer wrong" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "model.generate", arguments: { prompt: "hi" } } }),
      }),
      env,
      { fetchImpl },
    );
    assert.equal(wrong.status, 401);
    assert.equal(called, 0);
  });

  it("refuses to start MCP when the auth token secret is unset", async () => {
    const response = await handleRequest(
      new Request("https://example.workers.dev/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
      { OPENAI_API_KEY: "sk-test-secret" },
    );
    assert.equal(response.status, 503);
  });

  it("lists only the implemented tools", async () => {
    const response = await call("POST", { jsonrpc: "2.0", id: 2, method: "tools/list" }, {
      "content-type": "application/json",
      authorization: "Bearer test-token",
    });
    const body = await response.json();
    const names = body.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, ["model.generate", "mind.tool_inventory"]);
    assert.equal(JSON.stringify(body).includes("sk-test-secret"), false);
  });

  it("inventory marks unimplemented categories and does not call the network", async () => {
    let called = 0;
    const response = await handleRequest(
      new Request("https://example.workers.dev/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mind.tool_inventory", arguments: {} } }),
      }),
      env,
      { fetchImpl: async () => { called += 1; return new Response("no"); } },
    );
    const body = await response.json();
    const payload = JSON.parse(body.result.content[0].text);
    assert.equal(called, 0);
    assert.equal(payload.live_account_verified, false);
    assert.equal(payload.provider_billing_allowance, "unknown");
    const chat = payload.categories.find((item) => item.category === "chat.completions");
    const responses = payload.categories.find((item) => item.category === "responses");
    const assistants = payload.categories.find((item) => item.category === "assistants.threads");
    assert.equal(chat.dispatch, "implemented");
    assert.equal(responses.dispatch, "unimplemented");
    assert.equal(assistants.dispatch, "unimplemented");
    assert.match(assistants.notes, /2026-08-26/);
  });

  it("records reported usage once and does not substitute zero for missing usage", async () => {
    assert.deepEqual(usageFrom(undefined), { prompt_tokens: null, completion_tokens: null, total_tokens: null, usage_status: "unknown" });
    const calls = [];
    const response = await handleRequest(
      new Request("https://example.workers.dev/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "model.generate", arguments: { prompt: "hi", model: "gpt-test" } } }),
      }),
      env,
      {
        fetchImpl: async (url, init) => {
          calls.push({ url, init });
          return new Response(JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
          }), { status: 200 });
        },
      },
    );
    const body = await response.json();
    const payload = JSON.parse(body.result.content[0].text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(calls[0].init.headers.authorization, "Bearer sk-test-secret");
    assert.equal(payload.usage.prompt_tokens, 3);
    assert.equal(payload.usage.usage_status, "reported");
    assert.equal(payload.cost_usd, null);
    assert.equal(payload.provider_billing_allowance, "unknown");
    assert.equal(JSON.stringify(payload).includes("sk-test-secret"), false);
  });

  it("keeps a streamed response as one usage object from the final chunk", async () => {
    const calls = [];
    const sse = [
      'data: {"choices":[{"delta":{"content":"MCP "}}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
      'data: {"choices":[{"delta":{"content":"verified."}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}',
      "data: [DONE]",
    ].join("\n");
    const response = await handleRequest(
      new Request("https://example.workers.dev/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "model.generate", arguments: { prompt: "hi", stream: true } } }),
      }),
      env,
      {
        fetchImpl: async () => {
          calls.push(1);
          return new Response(sse, { status: 200 });
        },
      },
    );
    const payload = JSON.parse((await response.json()).result.content[0].text);
    assert.equal(calls.length, 1);
    assert.equal(payload.content, "MCP verified.");
    assert.equal(payload.streamed, true);
    assert.equal(payload.usage.total_tokens, 4);
    assert.notEqual(payload.usage.total_tokens, 6);
  });

  it("does not call OpenAI for a non-openai provider or a missing key", async () => {
    let called = 0;
    const fetchImpl = async () => { called += 1; return new Response("no"); };
    const other = await handleRequest(
      new Request("https://example.workers.dev/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "model.generate", arguments: { provider: "astra", prompt: "hi" } } }),
      }),
      env,
      { fetchImpl },
    );
    const otherPayload = JSON.parse((await other.json()).result.content[0].text);
    assert.equal(otherPayload.implementation, "not_implemented_on_this_worker");
    const missingKey = await handleRequest(
      new Request("https://example.workers.dev/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "model.generate", arguments: { prompt: "hi" } } }),
      }),
      { MCP_AUTH_TOKEN: "test-token" },
      { fetchImpl },
    );
    const missingPayload = JSON.parse((await missingKey.json()).result.content[0].text);
    assert.equal(missingPayload.this_call, "unconfigured");
    assert.equal(called, 0);
  });

  it("deploy config is the free workers.dev name with no paid bindings", () => {
    const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    const json = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
    assert.equal(json.name, "adrians-mind-mcp-tools");
    assert.equal(json.workers_dev, true);
    assert.equal(json.main, "src/index.js");
    for (const key of ["kv_namespaces", "d1_databases", "r2_buckets", "ai", "durable_objects", "queues", "routes", "route"]) {
      assert.equal(json[key], undefined);
    }
  });
});
