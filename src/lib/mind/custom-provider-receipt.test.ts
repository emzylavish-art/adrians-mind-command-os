import * as fixtureProviderHealth from "./provider-health.ts";
import * as fixtureProviderLifecycle from "./provider-lifecycle.ts";
import * as fixtureAiProviderStream from "./ai-provider-stream.ts";
import * as fixtureProviderCallStream from "./provider-call-stream.ts";
import * as fixtureProviderUsage from "./provider-usage.ts";
import * as fixtureProviderDependencies from "./provider-dependencies.ts";
import * as fixtureModelCapabilities from "./model-capabilities.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as native from "./ai-provider-native.ts";
import * as catalogue from "./provider-catalog.ts";
import * as receipt from "./provider-receipt.ts";
import { reportedModel } from "./stream.ts";

function customFixture(input: { dns?: boolean; credential?: string; row?: boolean; response?: Response }) {
  let calls = 0;
  const record = { id: "custom", label: "Fixture API", base_url: "https://api.openai.com/v1", key_ciphertext: input.credential ?? "encrypted-fixture",
    default_model: "selected", models: ["selected"], status: "catalogued", last_error: "" };
  const imports: Record<string, unknown> = {
    "./provider-health.ts": fixtureProviderHealth,
    "./provider-lifecycle.ts": fixtureProviderLifecycle,
    "./ai-provider-stream.ts": fixtureAiProviderStream,
    "./provider-call-stream.ts": fixtureProviderCallStream,
    "./provider-usage.ts": fixtureProviderUsage,
    "./provider-dependencies.ts": fixtureProviderDependencies,
    "./model-capabilities.ts": fixtureModelCapabilities,

    "node:crypto": { randomUUID }, "./ai-provider-native.ts": native, "./provider-catalog.ts": catalogue,
    "./provider-receipt.ts": receipt, "./stream.ts": { reportedModel },
    "../db.ts": { getSql: async () => ({ query: async (sql: string) => sql.startsWith("select") && input.row !== false ? [record] : [] }) },
    "./connectors/crypto.ts": { connectorTokenSecretStatus: () => ({ ok: true }), decryptSecret: () => "fixture-only", encryptSecret: () => "encrypted-fixture" },
    "./mcp/http-dns-pin.ts": {
      isLocalHostname: () => false, isPrivateAddressLiteral: () => false,
      resolveAndPinMcpHostname: async () => input.dns === false ? { ok: false } : { ok: true, pinnedAddress: "203.0.113.5", hostname: "fixture.invalid" },
      pinnedHttpFetch: async () => { calls++; return input.response ?? Response.json({}); },
    },
  };
  const source = ts.transpileModule(readFileSync(new URL("./ai-provider-config.server.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { executeCustomChat?: typeof import("./ai-provider-config.server.ts").executeCustomChat } = {};
  vm.runInNewContext(source, { exports, URL, AbortSignal, require: (name: string) => { if (!(name in imports)) throw Error(name); return imports[name]; } });
  return { call: () => exports.executeCustomChat!("owner", { id: "custom", model: "selected" }, [{ role: "user", content: "fixture" }]), get calls() { return calls; } };
}

it("AA043/044: custom-provider failure keeps reported usage, actual model and request identity", async () => {
  const fixture = customFixture({ response: Response.json({ model: "upstream-actual", usage: { prompt_tokens: 3, completion_tokens: 0 }, error: "private body detail" },
    { status: 500, headers: { "x-request-id": "error-request" } }) });
  const result = await fixture.call();
  assert.equal(fixture.calls, 1);
  assert.equal(result.ok, false); assert.equal(result.dispatched, true);
  assert.equal(result.model, "upstream-actual"); assert.equal(result.requestedModel, "selected");
  assert.equal(result.requestId, "error-request");
  assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 0 });
  assert.equal(result.executionLocation, "hosted");
  assert.doesNotMatch(JSON.stringify(result), /private body detail|encrypted-fixture|fixture-only/);
});

it("AA044: missing custom configuration, credentials and DNS preflight never claim dispatch", async () => {
  for (const input of [{ row: false }, { credential: "" }, { dns: false }]) {
    const fixture = customFixture(input);
    const result = await fixture.call();
    assert.equal(result.ok, false); assert.equal(result.dispatched, false);
    assert.equal(fixture.calls, 0);
  }
});
