import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as catalogue from "./provider-catalog.ts";
import * as native from "./ai-provider-native.ts";
import { consumeMindTurn } from "./live-turn.ts";
import { createChatTurnPreflight } from "./limits.ts";
import { stripTypeScriptTypes } from "node:module";
import { chatTurnBody } from "./logic-routes.ts";
import { builtinModules, collectConsultReport, isLocalConsultRunner, orchestratorInstruction, planModelConsult } from "./model-consult.ts";
import { selectProvider } from "./provider-call.ts";

function registryFixture(profile: catalogue.CatalogModelProfile | undefined, responseStatus = 200) {
  const writes: Array<{ query: string; values: any[] }> = [];
  let requests = 0;
  const row = { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", label: "Synthetic provider", base_url: "https://api.example.test/v1", key_ciphertext: "fixture-encrypted-key", default_model: "fixture-model", models: ["fixture-model"], model_profiles: profile ? { "fixture-model": profile } : {}, status: "configured", last_error: "" };
  const sql = { async query(query: string, values: any[]) { if (query.startsWith("select")) return [row]; writes.push({ query, values }); return []; } };
  const imports: Record<string, any> = {
    "node:crypto": { randomUUID: () => row.id },
    "./provider-catalog.ts": catalogue,
    "./ai-provider-native.ts": native,
    "../db.ts": { getSql: async () => sql },
    "./connectors/crypto.ts": { decryptSecret: () => "synthetic-test-only", connectorTokenSecretStatus: () => ({ ok: true }), encryptSecret: () => ({ ciphertext: "fixture" }) },
    "./mcp/http-dns-pin.ts": {
      isLocalHostname: () => false, isPrivateAddressLiteral: () => false,
      resolveAndPinMcpHostname: async () => ({ ok: true, pinnedAddress: "203.0.113.1", hostname: "api.example.test" }),
      pinnedHttpFetch: async () => { requests++; return { status: responseStatus, text: async () => JSON.stringify({ model: "upstream-reported", choices: [{ message: { content: "Fixture answer" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), headers: new Headers({ "x-request-id": "fixture-request" }) }; },
    },
  };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(new URL("./ai-provider-config.server.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require: (id: string) => { assert.ok(imports[id], id); return imports[id]; }, URL, AbortSignal, Date });
  return { exports, writes, requests: () => requests };
}
const profile = () => catalogue.normalizeCatalogModels([{ id: "fixture-model", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, context_length: 100, pricing: { prompt: "0", completion: "0" } }])[0];

test("C2 AA110–113: actual BYOK entry point blocks incompatible output/context and unknown free pricing before dispatch", async () => {
  for (const [given, text, freeOnly] of [
    [{ ...profile(), outputModalities: ["image"] }, "Hello", false],
    [profile(), "x".repeat(1000), false],
    [undefined, "Hello", true],
  ] as Array<[catalogue.CatalogModelProfile | undefined, string, boolean]>) {
    const h = registryFixture(given);
    const result = await h.exports.executeCustomChat("owner-a", { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", model: "fixture-model" }, [{ role: "user", content: text }], undefined, { freeOnly });
    assert.equal(result.ok, false);
    assert.equal(h.requests(), 0);
  }
});

test("C2 AA111: actual inference receipts bind model, owner and reported model without conflating provider health", async () => {
  const h = registryFixture(profile());
  const result = await h.exports.executeCustomChat("owner-a", { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", model: "fixture-model" }, [{ role: "user", content: "Hello" }]);
  assert.equal(result.ok, true);
  assert.equal(result.model, "upstream-reported");
  assert.equal(h.requests(), 1);
  const write = h.writes.find((item) => item.query.includes("jsonb_set"))!;
  assert.ok(write);
  assert.deepEqual(Array.from(write.values).slice(0, 3), ["owner-a", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "fixture-model"]);
  const receipt = JSON.parse(write.values[3]);
  assert.equal(receipt.reportedModel, "upstream-reported");
  assert.equal(receipt.outcome, "succeeded");
  const limited = registryFixture(profile(), 429);
  await limited.exports.executeCustomChat("owner-a", { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", model: "fixture-model" }, [{ role: "user", content: "Hello" }]);
  assert.equal(limited.writes.some((item) => /set status=/.test(item.query)), false, "one model rate limit must not mark every model unavailable");
  assert.equal(JSON.parse(limited.writes[0].values[3]).outcome, "rate_limited");
});

test("C2 AA047: helper receipt survives actual SSE parsing and client turn consumption", async () => {
  const receipt = { id: "helper", status: "completed", provider: "gemini", model: "reported-fixture-model", requestedModel: "requested-fixture-model", truncated: true, durationMs: 40, usage: { prompt_tokens: 3, completion_tokens: 2, secret: "must-not-survive" } };
  const payload = { text: "Fixture synthesis", model: "main-fixture", consult: [receipt], usedIds: [] };
  const result = await consumeMindTurn({ url: "https://fixture.invalid/turn", headers: {}, body: {}, signal: new AbortController().signal, onDelta() {}, fetchImpl: async () => new Response(`event: done\ndata: ${JSON.stringify(payload)}\n\n`, { headers: { "content-type": "text/event-stream" } }) });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.consult?.[0].model, receipt.model);
  assert.equal(result.consult?.[0].truncated, true);
  assert.equal(JSON.stringify(result.consult).includes("must-not-survive"), false);
});


test("C2 AA090: actual HTTP preflight charges every helper/final provider attempt, with one chat token", async () => {
  const source = readFileSync(new URL("./turn.server.ts", import.meta.url), "utf8");
  const start = source.indexOf("  const ratePreflight = createChatTurnPreflight");
  const end = source.indexOf("  let consultHelp", start);
  assert.ok(start >= 0 && end > start);
  let chatTokens = 0; let calls = 0;
  const context: any = { userId: "owner-fixture", request: { signal: new AbortController().signal },
    createChatTurnPreflight, checkStop: async () => null,
    consumeSharedMindRateLimit: async (bucket: string) => { if (bucket === "chat") { chatTokens++; return { ok: true }; } calls++; return calls <= 3 ? { ok: true } : { ok: false, retryAfterSec: 60 }; },
    json: (value: unknown, status: number) => Response.json(value, { status }), Response,
  };
  runInNewContext(stripTypeScriptTypes(`${source.slice(start, end)};globalThis.check = preflight;`), context);
  for (let i = 0; i < 3; i++) assert.equal(await context.check(), null);
  const denied = await context.check();
  assert.equal(denied.status, 429);
  assert.equal(chatTokens, 1);
  assert.equal(calls, 4);
});

test("C2 AA044/090: the actual server consultation block consumes request consent before a helper can dispatch", async () => {
  const source = readFileSync(new URL("./turn.server.ts", import.meta.url), "utf8");
  const start = source.indexOf('  let consultHelp = "";');
  const end = source.indexOf("  const tierField = parseModelTierField(body.modelTier)", start);
  assert.ok(start >= 0 && end > start);
  for (const [consent, freeOnly, expectedCalls, staleFinal] of [[false, false, 0, false], [true, false, 1, false], [true, true, 0, false], [true, false, 0, true]] as Array<[boolean, boolean, number, boolean]>) {
    let calls = 0;
    const main = staleFinal ? "openai" : "grok";
    const body = chatTurnBody({ text: "Review the implementation", memory: "off", halted: false, history: [], memoryContext: [], provider: main, modelTier: "Auto", logicRoute: null, images: [], composerMode: "orchestrator", orchestrator: main, freeOnly, requestedModel: staleFinal ? "stale-model" : undefined,
      consult: { available: ["grok", "openai"], helpers: [], purpose: "Synthesize", helperIds: [staleFinal ? "grok" : "openai"], allowPaidHelpers: consent } });
    const context: any = { body, userId: "owner-fixture", request: { signal: new AbortController().signal },
      parseModelTierField: () => ({ ok: true }), checkTurnSize: () => ({ ok: true }), sanitizeAttachments: () => [], isHistory: () => true, isNote: () => true,
      modulesConnectedNow: async () => builtinModules({ grokConfigured: true, providers: { openai: true } }),
      planModelConsult, collectConsultReport, orchestratorInstruction, selectProvider, process: { env: { OPENAI_API_KEY: "synthetic-key" } },
      checkStop: async () => null, ratePreflight: async () => null, preflight: async () => null, markDispatched() {},
      askConnectedModule: async () => { calls++; return { ok: true, text: "Synthetic helper evidence", provider: "openai", model: "fixture-model" }; },
      json: (value: unknown, status: number) => Response.json(value, { status }),
    };
    runInNewContext(stripTypeScriptTypes(`globalThis.invoke = async () => {${source.slice(start, end)} return {consultAttempts}; };`), context);
    const result = await context.invoke();
    assert.equal(calls, expectedCalls);
    if (expectedCalls === 0) assert.equal(result.status, staleFinal ? 409 : 400);
    else assert.equal(result.consultAttempts[0].status, "completed");
  }
});

test("C2 AA014/090: the actual direct free-only gate rejects paid, unknown and remote-runner answering routes", async () => {
  const source = readFileSync(new URL("./turn.server.ts", import.meta.url), "utf8");
  const start = source.indexOf("  if (body.freeOnly !== undefined");
  const end = source.indexOf("  const ratePreflight", start);
  assert.ok(start >= 0 && end > start);
  const cases: Array<{ body: Record<string, unknown>; localUrl?: string; allowed: boolean }> = [
    ...["grok", "openai", "anthropic", "gemini", "astra", "unknown"].map((provider) => ({ body: { provider, freeOnly: true }, allowed: false })),
    { body: { provider: "openrouter", freeOnly: true }, allowed: true },
    { body: { provider: "nemotron", freeOnly: true }, allowed: true },
    { body: { provider: "ollama", freeOnly: true }, localUrl: "http://127.0.0.1:11434", allowed: true },
    { body: { provider: "ollama", freeOnly: true }, localUrl: "https://remote.fixture.invalid", allowed: false },
    { body: { provider: "openrouter", logicRoute: "sol", freeOnly: true }, allowed: false },
    { body: { provider: "grok", freeOnly: "true" }, allowed: false },
  ];
  for (const item of cases) {
    const context: any = { body: item.body, process: { env: { LOCAL_MODEL_URL: item.localUrl } }, isLocalConsultRunner, json: (value: unknown, status: number) => Response.json(value, { status }) };
    runInNewContext(stripTypeScriptTypes(`globalThis.invoke = () => {${source.slice(start, end)} return null; };`), context);
    const result = context.invoke();
    assert.equal(result === null, item.allowed, JSON.stringify(item.body));
  }
});
