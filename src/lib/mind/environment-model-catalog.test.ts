import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Sql } from "../db.ts";
import { catalogForProvider, environmentModelChoices, environmentModelReadiness, MODEL_CATALOG_TTL_MS, normalizeEnvironmentCatalog } from "./environment-model-catalog.ts";
import { listEnvironmentModelCatalogs, refreshEnvironmentModelCatalog, validateEnvironmentModel, type EnvironmentCatalogDeps } from "./environment-model-catalog.server.ts";
import { modelTierCatalog } from "./model-tiers.ts";
import { validatePrimaryConfiguration } from "./turn-primary-selection.ts";
import { readSelection, writeSelection } from "./logic-routes.ts";

function fixture(env: Record<string, string | undefined> = { XAI_API_KEY: "xai-fixture-" + "a".repeat(64) }) {
  const records = new Map<string, Record<string, unknown>>();
  let now = Date.now();
  const sql = { query: async <T>(query: string, args: unknown[] = []) => {
    if (query.startsWith("select")) { assert.match(query, /where user_id=\$1/); return [...records.values()].filter(row => row.user_id === args[0]) as T[]; }
    assert.match(query, /^insert into mind_environment_model_catalogs/);
    records.set(`${args[0]}:${args[1]}`, { user_id: args[0], provider: args[1], credential_fingerprint: args[2], state: args[3], models: JSON.parse(String(args[4])), capabilities: JSON.parse(String(args[5])), last_error: args[6], checked_at: args[7] });
    return [] as T[];
  } } as unknown as Sql;
  const deps: EnvironmentCatalogDeps = { env, sql, now: () => now };
  return { deps, env, records, advance: (ms: number) => { now += ms; }, now: () => now };
}

test("reading configuration never probes a provider or promotes it to inference verified", async () => {
  const f = fixture(); let calls = 0;
  const catalogs = await listEnvironmentModelCatalogs("A", { ...f.deps, fetchImpl: async () => { calls++; throw new Error("No probe"); } });
  assert.equal(calls, 0); assert.equal(catalogForProvider(catalogs, "grok")?.state, "unverified");
  assert.equal(catalogForProvider(catalogs, "openai")?.state, "unconfigured");
  assert.equal(catalogs.every(row => row.inferenceVerified === false), true);
});

test("manual metadata refresh, picker, Auto and dispatch agree when the exact resolved model disappears", async () => {
  const f = fixture(); Object.assign(f.env, { MIND_MODEL_FAST: "grok-fixture-fast", MIND_MODEL_HEAVY: "grok-fixture-heavy" });
  let listed = ["grok-fixture-fast", "grok-fixture-heavy"], fetches = 0;
  const deps = { ...f.deps, fetchImpl: (async (url, init) => { fetches++; assert.equal(String(url), "https://api.x.ai/v1/language-models"); assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); return Response.json({ models: listed.map(id => ({ id, input_modalities: ["text"], context_length: 8192, max_output_tokens: 2048 })) }); }) as typeof fetch };
  const first = await refreshEnvironmentModelCatalog("A", "grok", deps); assert.equal(first.ok, true);
  if (!first.ok) throw new Error("Expected first catalogue fixture to succeed");
  const input = { provider: "grok", modelTier: "Auto", text: "hello", imageCount: 0, controls: {}, memory: "off", xai: { ok: true } };
  assert.equal(validatePrimaryConfiguration({ ...input, catalog: first.catalog }, f.env).ok, true);
  assert.equal((await validateEnvironmentModel("A", "grok", "grok-fixture-fast", {}, deps)).ok, true);
  listed = ["grok-fixture-heavy"];
  const changed = await refreshEnvironmentModelCatalog("A", "grok", deps); assert.equal(changed.ok, true);
  if (!changed.ok) throw new Error("Expected changed catalogue fixture to succeed");
  const choice = environmentModelChoices(changed.catalog, ["grok-fixture-fast"], "grok-fixture-fast").find(row => row.model === "grok-fixture-fast")!;
  assert.equal(choice.ok, false); assert.equal(choice.availability, "unavailable");
  assert.equal(modelTierCatalog(f.env, changed.catalog).find(row => row.id === "Fast")?.availability, "unavailable");
  assert.equal(modelTierCatalog({}, changed.catalog).find(row => row.id === "Auto")?.availability, "unavailable", "Auto is unavailable when all its configured candidates are absent");
  const auto = validatePrimaryConfiguration({ ...input, catalog: changed.catalog }, f.env);
  assert.equal(auto.ok, false); if (!auto.ok) assert.match(auto.error, /grok-fixture-fast/);
  assert.equal((await validateEnvironmentModel("A", "xai", "grok-fixture-fast", {}, deps)).ok, false);
  assert.equal(fetches, 2, "only the two explicit metadata refreshes may contact the provider");
});

test("declared modality and output changes affect the same model without a provider-name fallback", async () => {
  const f = fixture(); let image = true, maximum = 2048;
  const refresh = () => refreshEnvironmentModelCatalog("A", "grok", { ...f.deps, fetchImpl: async () => Response.json({ models: [{ id: "grok-new-fixture", aliases: ["grok-new-alias"], input_modalities: image ? ["text", "image"] : ["text"], context_window: 8192, max_input_tokens: 4096, max_output_tokens: maximum }] }) });
  const first = await refresh(); assert.equal(first.ok, true); if (!first.ok) throw new Error("Expected first catalogue fixture to succeed");
  assert.equal(environmentModelReadiness(first.catalog, "grok-new-alias", { images: 1, outputTokens: 1024 }).ok, true);
  assert.equal(first.catalog.capabilities["grok-new-fixture"].contextWindowTokens, 8192);
  const input = { provider: "grok", requestedModel: "grok-new-fixture", modelTier: "Fast", text: "hello", imageCount: 1, controls: {}, memory: "off", xai: { ok: true } };
  assert.equal(validatePrimaryConfiguration({ ...input, catalog: first.catalog }, f.env).ok, true);
  image = false; maximum = 256;
  const second = await refresh(); assert.equal(second.ok, true); if (!second.ok) throw new Error("Expected second catalogue fixture to succeed");
  assert.equal(validatePrimaryConfiguration({ ...input, catalog: second.catalog }, f.env).ok, false);
  assert.equal(validatePrimaryConfiguration({ ...input, imageCount: 0, catalog: second.catalog }, f.env).ok, false, "the actual Fast default400 is checked before helpers too");
  assert.equal(environmentModelReadiness(second.catalog, "grok-new-fixture", { images: 1 }).ok, false);
});

test("catalogues are owner and credential bound, and their expiry never becomes an automatic refresh", async () => {
  const f = fixture(); let calls = 0;
  const deps = { ...f.deps, fetchImpl: async () => { calls++; return Response.json({ models: [{ id: "grok-4.5", input_modalities: ["text", "image"] }] }); } };
  await refreshEnvironmentModelCatalog("A", "grok", deps);
  assert.equal(catalogForProvider(await listEnvironmentModelCatalogs("B", deps), "grok")?.state, "unverified");
  const publicJson = JSON.stringify(await listEnvironmentModelCatalogs("A", deps));
  assert.equal(publicJson.includes(f.env.XAI_API_KEY!), false); assert.equal(publicJson.includes("credential_fingerprint"), false);
  f.advance(MODEL_CATALOG_TTL_MS + 1);
  const stale = catalogForProvider(await listEnvironmentModelCatalogs("A", deps), "grok")!;
  assert.equal(stale.state, "stale"); assert.equal(normalizeEnvironmentCatalog(stale, f.now())?.state, "stale");
  assert.equal(environmentModelReadiness(stale, "grok-4.5", {}, f.now()).ok, false);
  assert.equal(modelTierCatalog({}, stale).find(row => row.id === "Auto")?.availability, "stale");
  assert.equal((await validateEnvironmentModel("A", "grok", "grok-4.5", {}, deps)).ok, false); assert.equal(calls, 1);
  f.env.XAI_API_KEY = "xai-replacement-" + "b".repeat(64);
  const rotated = catalogForProvider(await listEnvironmentModelCatalogs("A", deps), "grok")!;
  assert.equal(rotated.state, "unverified"); assert.deepEqual(rotated.models, []); assert.equal(rotated.inferenceVerified, false);
});

test("rejected or incomplete discovery blocks known catalogue readiness without retrying inference", async () => {
  const f = fixture({ OPENAI_API_KEY: "synthetic-openai" }); let calls = 0;
  const failed = await refreshEnvironmentModelCatalog("A", "openai", { ...f.deps, fetchImpl: async () => { calls++; return Response.json({}, { status: 401 }); } });
  assert.equal(failed.ok, false); assert.equal(failed.catalog?.state, "unavailable"); assert.equal(calls, 1);
  assert.equal((await validateEnvironmentModel("A", "openai", "gpt-4.1-mini", {}, f.deps)).ok, false);
  const partial = await refreshEnvironmentModelCatalog("A", "openai", { ...f.deps, fetchImpl: async () => { calls++; return Response.json({ data: [{ id: "gpt-4.1-mini" }], has_more: true }); } });
  assert.equal(partial.ok, false); assert.deepEqual(partial.catalog?.models, []); assert.equal(calls, 2);
  const malformed = await refreshEnvironmentModelCatalog("A", "openai", { ...f.deps, fetchImpl: async () => { calls++; return Response.json({ data: [{ unrelated: true }] }); } });
  assert.equal(malformed.ok, false); assert.equal(calls, 3);
});

test("documented Gemini and Anthropic pagination is bounded and preserves model limits", async () => {
  const f = fixture({ GEMINI_API_KEY: "synthetic-gemini", ANTHROPIC_API_KEY: "synthetic-anthropic" });
  const calls: string[] = [];
  const gemini = await refreshEnvironmentModelCatalog("A", "gemini", { ...f.deps, fetchImpl: (async url => { calls.push(String(url)); return String(url).includes("pageToken=") ? Response.json({ models: [{ name: "models/gemini-second", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 8000, outputTokenLimit: 1000 }] }) : Response.json({ models: [{ name: "models/embedding", supportedGenerationMethods: ["embedContent"] }], nextPageToken: "next-fixture" }); }) as typeof fetch });
  assert.equal(gemini.ok, true); if (!gemini.ok) throw new Error("Expected gemini catalogue fixture to succeed");
  assert.deepEqual(gemini.catalog.models, ["gemini-second"]); assert.equal(gemini.catalog.capabilities["gemini-second"].maxInputTokens, 8000); assert.equal(calls.length, 2);
  const anthropic = await refreshEnvironmentModelCatalog("A", "anthropic", { ...f.deps, fetchImpl: (async url => String(url).includes("after_id=") ? Response.json({ data: [{ id: "claude-fixture", max_input_tokens: 6000, max_tokens: 1000 }], has_more: false }) : Response.json({ data: [{ id: "claude-retired", lifecycle: "retired" }], has_more: true, last_id: "claude-retired" })) as typeof fetch });
  assert.equal(anthropic.ok, true); if (!anthropic.ok) throw new Error("Expected anthropic catalogue fixture to succeed");
  assert.deepEqual(anthropic.catalog.models, ["claude-fixture"]); assert.equal(anthropic.catalog.capabilities["claude-fixture"].maxOutputTokens, 1000);
});

test("native local discovery uses only configured tags endpoint; a legacy runner is never probed", async () => {
  const f = fixture({ LOCAL_MODEL_URL: "http://localhost:11434/api/generate", OLLAMA_MODEL: "fixture:latest" }); let calls = 0;
  const deps = { ...f.deps, fetchImpl: (async (url, init) => { calls++; assert.equal(String(url), "http://localhost:11434/api/tags"); assert.equal(init?.method, "GET"); return Response.json({ models: [{ name: "fixture:latest" }] }); }) as typeof fetch };
  assert.equal((await refreshEnvironmentModelCatalog("A", "ollama", deps)).ok, true);
  assert.equal((await validateEnvironmentModel("A", "ollama", "removed", {}, deps)).ok, false);
  f.env.LOCAL_MODEL_URL = "http://localhost:9000/legacy";
  const refused = await refreshEnvironmentModelCatalog("A", "ollama", deps);
  assert.equal(refused.ok, false); assert.equal(calls, 1); assert.equal(refused.catalog?.state, "unverified");
});

test("newly discovered or later missing explicit Grok choices survive account-scoped selection storage", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  writeSelection(storage, { provider: "grok", modelTier: "Fast", logicRoute: null, grokModel: "grok-new-fixture" });
  assert.equal(readSelection(storage).grokModel, "grok-new-fixture", "persistence does not silently change a currently unavailable selection");
});

test("the mounted dispatch checks current catalogue before helpers and immediately before reservation", () => {
  const source = readFileSync(new URL("./turn.server.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("const primaryReadiness = await validateEnvironmentModel") < source.indexOf("const help = await collectConsultHelp"));
  const preflight = source.slice(source.indexOf("const preflight = async"), source.indexOf('if (body.composerMode === "orchestrator")'));
  assert.ok(preflight.indexOf("await validateEnvironmentModel") >= 0);
  assert.ok(preflight.indexOf("if (!compatible.ok)") < preflight.indexOf("await reserveOwnerDispatch"));
  const route = readFileSync(new URL("../../routes/api/mind/providers.ts", import.meta.url), "utf8");
  assert.match(route, /discover-environment/); assert.match(route, /refreshEnvironmentModelCatalog\(userId, data\.provider\)/);
});
