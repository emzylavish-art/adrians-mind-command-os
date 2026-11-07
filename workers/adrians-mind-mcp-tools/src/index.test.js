import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { budgetDecision, handleRequest, pkceChallenge, publicStatus } from "./index.js";

const ORIGIN = "https://adrians-mind-mcp-test.operation-beat-magnus.workers.dev";
const TEAM = "adriansmind.cloudflareaccess.com";
const AUD = "f3d3c26edffe9b02e90616706ed7622c3b96f80e7b1b43ef111eecbb72fdcd37";
const CERTS = `https://${TEAM}/cdn-cgi/access/certs`;

function b64urlBytes(bytes) {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function accessSigner() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  async function sign(payload, header = { alg: "RS256", kid: "test-key", typ: "JWT" }) {
    const encodedHeader = b64urlBytes(new TextEncoder().encode(JSON.stringify(header)));
    const encodedPayload = b64urlBytes(new TextEncoder().encode(JSON.stringify(payload)));
    const signature = new Uint8Array(await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    ));
    return `${encodedHeader}.${encodedPayload}.${b64urlBytes(signature)}`;
  }
  return { jwk, sign };
}

function certFetch(jwk, next) {
  return async (url, init) => {
    if (url === CERTS) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    if (next) return next(url, init);
    return new Response("unexpected", { status: 404 });
  };
}

function ownerClaims(extra = {}) {
  return {
    iss: `https://${TEAM}`,
    aud: AUD,
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: "emzylavish@gmail.com",
    ...extra,
  };
}

function memoryKv() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

function env(extra = {}) {
  return {
    OAUTH_KV: memoryKv(),
    MCP_OAUTH_ISSUER: ORIGIN,
    MCP_OAUTH_AUDIENCE: `${ORIGIN}/mcp`,
    MCP_OAUTH_SECRET: "oauth-secret",
    MCP_TRUST_ACCESS_IDENTITY: "1",
    CF_ACCESS_TEAM_DOMAIN: TEAM,
    CF_ACCESS_AUD: AUD,
    CF_ACCESS_ALLOWED_EMAIL: "emzylavish@gmail.com",
    OPENAI_API_KEY: "sk-test-secret",
    MIND_COMMAND_BUDGET_OWNER_OVERRIDE: "1",
    ...extra,
  };
}

async function login(runtime = env()) {
  const signer = await accessSigner();
  const verifier = "verifier-value-which-is-long-enough";
  const challenge = await pkceChallenge(verifier);
  const jwt = await signer.sign(ownerClaims());
  const redirect = encodeURIComponent(`${ORIGIN}/oauth/test-callback`);
  const authorize = await handleRequest(new Request(
    `${ORIGIN}/oauth/authorize?response_type=code&client_id=adrians-mind-mcp-test&redirect_uri=${redirect}&scope=mind.tools&code_challenge_method=S256&code_challenge=${challenge}&state=state-1-is-long-enough-ok`,
    { headers: { "cf-access-jwt-assertion": jwt, "cf-access-authenticated-user-email": "forged@example.test" } },
  ), runtime, { fetchImpl: certFetch(signer.jwk) });
  assert.equal(authorize.status, 302);
  const code = new URL(authorize.headers.get("location")).searchParams.get("code");
  const token = await handleRequest(new Request(`${ORIGIN}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: "adrians-mind-mcp-test",
      redirect_uri: `${ORIGIN}/oauth/test-callback`,
      code_verifier: verifier,
    }),
  }), runtime);
  const body = await token.json();
  assert.equal(token.status, 200);
  assert.equal(body.scope, "mind.tools");
  return body.access_token;
}

function mcp(token, method, params, runtime, deps) {
  return handleRequest(new Request(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), runtime, deps);
}

describe("adrians-mind-mcp-test oauth edge", () => {
  it("fails closed when OAuth KV or issuer config is missing", async () => {
    const response = await handleRequest(new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer anything" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }), { MCP_OAUTH_ISSUER: ORIGIN });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error, "oauth_unconfigured");
    assert.ok(body.missing.includes("OAUTH_KV"));
    assert.equal(JSON.stringify(body).includes("sk-"), false);
  });

  it("rejects missing, wrong, spoofed, and dev-subject logins", async () => {
    const runtime = env();
    const missing = await handleRequest(new Request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }), runtime);
    assert.equal(missing.status, 401);
    let fetched = 0;
    const spoofed = await handleRequest(new Request(
      `${ORIGIN}/oauth/authorize?response_type=code&client_id=adrians-mind-mcp-test&redirect_uri=${encodeURIComponent(`${ORIGIN}/oauth/test-callback`)}&scope=mind.tools&code_challenge_method=S256&code_challenge=abc`,
      { headers: { "cf-access-authenticated-user-email": "emzylavish@gmail.com", "x-authenticated-user": "emzylavish@gmail.com" } },
    ), runtime, { fetchImpl: async () => { fetched += 1; return new Response("no"); } });
    assert.equal(spoofed.status, 401);
    assert.equal(fetched, 0);
    const dev = await handleRequest(new Request(`${ORIGIN}/oauth/authorize?response_type=code&client_id=adrians-mind-mcp-test`), env({
      MCP_TRUST_ACCESS_IDENTITY: "0",
      MCP_OAUTH_DEV_SUBJECT: "emzylavish@gmail.com",
    }));
    const devBody = await dev.json();
    assert.equal(dev.status, 401);
    assert.match(devBody.error_description, /not enabled/);
  });

  it("rejects a JWT when Access audience config is missing and accepts a signed owner token", async () => {
    const signer = await accessSigner();
    const jwt = await signer.sign(ownerClaims());
    const missing = await handleRequest(new Request(`${ORIGIN}/oauth/authorize`, { headers: { "cf-access-jwt-assertion": jwt } }), env({ CF_ACCESS_AUD: "" }), { fetchImpl: certFetch(signer.jwk) });
    const missingBody = await missing.json();
    assert.equal(missing.status, 401);
    assert.match(missingBody.error_description, /not configured/);
    const other = await handleRequest(new Request(
      `${ORIGIN}/oauth/authorize?response_type=code&client_id=adrians-mind-mcp-test&redirect_uri=${encodeURIComponent(`${ORIGIN}/oauth/test-callback`)}&scope=mind.tools&code_challenge_method=S256&code_challenge=abc`,
      { headers: { "cf-access-jwt-assertion": await signer.sign(ownerClaims({ email: "other@example.test" })) } },
    ), env(), { fetchImpl: certFetch(signer.jwk) });
    assert.equal(other.status, 401);
  });

  it("stores the harness verifier privately and returns redacted MCP evidence", async () => {
    const runtime = env();
    const signer = await accessSigner();
    const start = await handleRequest(new Request(`${ORIGIN}/oauth/test-start`), runtime);
    assert.equal(start.status, 302);
    const startUrl = new URL(start.headers.get("location"));
    assert.equal(startUrl.origin + startUrl.pathname, `${ORIGIN}/oauth/authorize`);
    assert.equal(startUrl.searchParams.get("code_verifier"), null);
    const jwt = await signer.sign(ownerClaims());
    const authorize = await handleRequest(new Request(startUrl, {
      headers: { "cf-access-jwt-assertion": jwt, "cf-access-authenticated-user-email": "forged@example.test" },
    }), runtime, { fetchImpl: certFetch(signer.jwk) });
    assert.equal(authorize.status, 302);
    const callbackUrl = new URL(authorize.headers.get("location"));
    const code = callbackUrl.searchParams.get("code");
    const seen = [];
    const callback = await handleRequest(new Request(callbackUrl), runtime, {
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body);
        seen.push({ url, authorization: init.headers.authorization, method: body.method });
        const payload = body.method === "initialize"
          ? { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", serverInfo: { name: "adrians-mind-mcp-test" } } }
          : body.method === "tools/list"
            ? { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "provider.status" }, { name: "model.generate" }] } }
            : { jsonrpc: "2.0", id: 3, result: { isError: false, content: [{ type: "text", text: "{\"upstream_called\":false}" }] } };
        return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-1", "set-cookie": "session=secret" } });
      },
    });
    const callbackText = await callback.text();
    assert.equal(callback.status, 302);
    assert.equal(callbackText.includes(code), false);
    assert.deepEqual(seen.map((call) => call.method), ["initialize", "tools/list", "tools/call"]);
    assert.equal(seen.every((call) => call.url === `${ORIGIN}/mcp` && call.authorization.startsWith("Bearer ")), true);
    const resultUrl = new URL(callback.headers.get("location"), ORIGIN);
    const result = await handleRequest(new Request(resultUrl), runtime);
    const evidence = await result.json();
    const serialized = JSON.stringify(evidence);
    assert.equal(evidence.ok, true);
    assert.equal(evidence.transport, "public_https");
    assert.equal(evidence.testedURL, `${ORIGIN}/mcp`);
    assert.equal(evidence.fetch_path, "injected");
    assert.equal(evidence.external_network_verified, false);
    assert.deepEqual(evidence.calls.map((call) => call.http_status), [200, 200, 200]);
    assert.equal(evidence.calls[0].headers["x-request-id"], "req-1");
    assert.equal(evidence.calls[0].headers["set-cookie"], undefined);
    assert.equal(serialized.includes(code), false);
    assert.equal(serialized.includes(seen[0].authorization), false);
    assert.equal(serialized.includes("access_token"), false);
    assert.equal(serialized.includes("sk-test-secret"), false);
    assert.equal(serialized.includes("session=secret"), false);
    const replay = await handleRequest(new Request(resultUrl), runtime);
    assert.equal(replay.status, 404);
  });

  it("does not send the bearer to any issuer other than the test host", async () => {
    const runtime = env({ MCP_OAUTH_ISSUER: "https://evil.example", MCP_OAUTH_AUDIENCE: "https://evil.example/mcp" });
    const signer = await accessSigner();
    const start = await handleRequest(new Request("https://evil.example/oauth/test-start"), runtime);
    const startUrl = new URL(start.headers.get("location"));
    const authorize = await handleRequest(new Request(startUrl, {
      headers: { "cf-access-jwt-assertion": await signer.sign(ownerClaims()) },
    }), runtime, { fetchImpl: certFetch(signer.jwk) });
    let called = 0;
    const callback = await handleRequest(new Request(authorize.headers.get("location")), runtime, {
      fetchImpl: async () => { called += 1; return new Response("no", { status: 500 }); },
    });
    const evidence = await (await handleRequest(new Request(new URL(callback.headers.get("location"), "https://evil.example")), runtime)).json();
    assert.equal(called, 0);
    assert.equal(evidence.ok, false);
    assert.equal(evidence.error, "issuer_not_allowed");
    assert.equal(evidence.testedURL, null);
  });

  it("requires every public MCP response to be HTTP 200 and not isError", async () => {
    const runtime = env();
    const signer = await accessSigner();
    const start = await handleRequest(new Request(`${ORIGIN}/oauth/test-start`), runtime);
    const authorize = await handleRequest(new Request(start.headers.get("location"), {
      headers: { "cf-access-jwt-assertion": await signer.sign(ownerClaims()) },
    }), runtime, { fetchImpl: certFetch(signer.jwk) });
    const callback = await handleRequest(new Request(authorize.headers.get("location")), runtime, {
      fetchImpl: async (_url, init) => {
        const method = JSON.parse(init.body).method;
        const result = method === "tools/call" ? { isError: true, content: [] } : { tools: [] };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: method === "initialize" ? 500 : 200 });
      },
    });
    const evidence = await (await handleRequest(new Request(new URL(callback.headers.get("location"), ORIGIN)), runtime)).json();
    assert.equal(evidence.ok, false);
    assert.equal(evidence.calls[0].http_status, 500);
    assert.equal(evidence.calls[2].response.result.isError, true);
  });

  it("completes PKCE and calls provider.status without an upstream request", async () => {
    const runtime = env();
    let called = 0;
    const token = await login(runtime);
    const discovery = await handleRequest(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), runtime);
    const meta = await discovery.json();
    assert.equal(meta.issuer, ORIGIN);
    assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(meta.scopes_supported, ["mind.tools"]);
    const listed = await mcp(token, "tools/list", {}, runtime);
    const names = (await listed.json()).result.tools.map((tool) => tool.name);
    assert.deepEqual(names, ["provider.status", "model.generate"]);
    const status = await mcp(token, "tools/call", { name: "provider.status", arguments: {} }, runtime, {
      fetchImpl: async () => { called += 1; return new Response("no"); },
    });
    const payload = JSON.parse((await status.json()).result.content[0].text);
    assert.equal(called, 0);
    assert.equal(payload.upstream_called, false);
    assert.equal(payload.live_verified, false);
    assert.equal(payload.app_budget.owner_override, true);
    assert.equal(payload.app_budget.limit_usd, 500);
    assert.equal(payload.app_budget.spent_usd, 0);
    assert.equal(payload.app_budget.accounting, "baseline");
    assert.equal(payload.providers.find((item) => item.id === "astra").model, "gpt-6-astra");
    assert.equal(JSON.stringify(payload).includes("sk-test-secret"), false);
  });

  it("routes Astra then Sol once each and keeps the successful usage", async () => {
    const runtime = env();
    const token = await login(runtime);
    const calls = [];
    const response = await mcp(token, "tools/call", {
      name: "model.generate",
      arguments: { provider: "auto", prompt: "hi" },
    }, runtime, {
      fetchImpl: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body), authorization: init.headers.authorization });
        if (calls.length === 1) return new Response("no", { status: 503 });
        return new Response(JSON.stringify({
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        }), { status: 200 });
      },
    });
    const payload = JSON.parse((await response.json()).result.content[0].text);
    assert.deepEqual(calls.map((call) => call.body.model), ["gpt-6-astra", "gpt-6-sol"]);
    assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(payload.provider, "sol");
    assert.equal(payload.usage.total_tokens, 3);
    assert.equal(payload.usage.usage_status, "reported");
    assert.equal(payload.cost_usd, null);
    assert.deepEqual(payload.route.attempted, ["astra", "sol"]);
  });

  it("does not call upstream when the app cap is exhausted without owner override", async () => {
    const runtime = env({
      MIND_COMMAND_BUDGET_OWNER_OVERRIDE: "0",
      MIND_COMMAND_BUDGET_LIMIT_USD: "500",
      MIND_COMMAND_BUDGET_SPENT_USD: "500",
    });
    const token = await login(runtime);
    let called = 0;
    const response = await mcp(token, "tools/call", {
      name: "model.generate",
      arguments: { prompt: "hi" },
    }, runtime, { fetchImpl: async () => { called += 1; return new Response("no"); } });
    const payload = JSON.parse((await response.json()).result.content[0].text);
    assert.equal(called, 0);
    assert.equal(payload.upstream_called, false);
    assert.match(payload.error, /exhausted/);
  });

  it("owner override still allows the call at the 500 baseline cap", () => {
    const decision = budgetDecision({
      MIND_COMMAND_BUDGET_LIMIT_USD: "500",
      MIND_COMMAND_BUDGET_SPENT_USD: "500",
      MIND_COMMAND_BUDGET_OWNER_OVERRIDE: "1",
    });
    assert.equal(decision.paused, false);
    assert.equal(decision.app_cap, "owner_override");
    assert.equal(decision.limit_usd, 500);
  });

  it("refuses a non-OpenAI base URL and leaves missing usage unknown", async () => {
    const runtime = env({ ASTRA_API_BASE_URL: "https://evil.example/v1/chat/completions", ASTRA_API_KEY: "sk-astra" });
    assert.equal(publicStatus(runtime).providers.find((item) => item.id === "astra").configured, false);
    const token = await login(runtime);
    const calls = [];
    const response = await mcp(token, "tools/call", {
      name: "model.generate",
      arguments: { provider: "sol", prompt: "hi", stream: true },
    }, runtime, {
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n', { status: 200 });
      },
    });
    const payload = JSON.parse((await response.json()).result.content[0].text);
    assert.deepEqual(calls, ["https://api.openai.com/v1/chat/completions"]);
    assert.equal(payload.model, "gpt-6-sol");
    assert.equal(payload.usage.usage_status, "unknown");
    assert.equal(payload.usage.prompt_tokens, null);
  });

  it("deploy metadata names the isolated test worker and KV binding", () => {
    const wrangler = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
    const metadata = JSON.parse(readFileSync(new URL("../bundle/metadata.json", import.meta.url), "utf8"));
    assert.equal(wrangler.name, "adrians-mind-mcp-test");
    assert.equal(wrangler.vars.MCP_OAUTH_ISSUER, ORIGIN);
    assert.equal(wrangler.vars.CF_ACCESS_TEAM_DOMAIN, TEAM);
    assert.equal(wrangler.vars.CF_ACCESS_AUD, AUD);
    assert.equal(wrangler.vars.MCP_TRUST_ACCESS_IDENTITY, "1");
    assert.equal(wrangler.vars.CF_ACCESS_ALLOWED_EMAIL, "emzylavish@gmail.com");
    assert.deepEqual(wrangler.compatibility_flags, ["global_fetch_strictly_public"]);
    assert.deepEqual(metadata.compatibility_flags, ["global_fetch_strictly_public"]);
    assert.equal(wrangler.kv_namespaces[0].binding, "OAUTH_KV");
    assert.equal(metadata.main_module, "index.js");
    assert.equal(JSON.stringify(metadata).includes("adrians-mind-mcp-oauth"), false);
    assert.equal(metadata.bindings.some((binding) => binding.name === "OAUTH_KV"), true);
  });
});
