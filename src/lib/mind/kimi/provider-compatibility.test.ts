import assert from "node:assert/strict";
import test from "node:test";
import type { PublicAiProvider } from "../ai-provider-config.server.ts";
import {
  buildKimiProviderCatalog,
  selectVerifiedKimiProvider,
  type KimiProviderChecks,
  type KimiProviderEvidence,
} from "./provider-compatibility.ts";

const checks: KimiProviderChecks = {
  auth: "passed",
  streaming: "passed",
  toolCalls: "passed",
  cancellation: "passed",
  usage: "passed",
};

const provider: PublicAiProvider = {
  id: "provider-a",
  label: "Team Provider",
  host: "api.example.test",
  defaultModel: "model-a",
  models: ["model-a", "model-b"],
  status: "catalogued",
  lastError: "",
  hasKey: true,
};

function evidence(overrides: Partial<KimiProviderEvidence> = {}): KimiProviderEvidence {
  return {
    runtime: "kimi-acp",
    runtimeVersion: "1.0.0",
    providerId: "provider-a",
    model: "model-a",
    checkedAt: 100,
    checks,
    ...overrides,
  };
}

test("configured Adrian providers remain unaudited for Kimi until exact runtime/model evidence exists", () => {
  const [entry] = buildKimiProviderCatalog([provider], []);
  assert.equal(entry?.models[0]?.readiness, "NOT_AUDITED");
  assert.equal(entry?.models[0]?.checks, null);
});

test("every required per-model check must pass before a provider model is verified", () => {
  const [entry] = buildKimiProviderCatalog([provider], [evidence()]);
  assert.equal(entry?.models[0]?.readiness, "VERIFIED");
  assert.equal(entry?.models[1]?.readiness, "NOT_AUDITED");
  assert.equal(entry?.models[0]?.runtimeVersion, "1.0.0");
});

test("provider catalog is secret-free and excludes endpoints and credentials", () => {
  const catalog = buildKimiProviderCatalog([provider], [evidence()]);
  const text = JSON.stringify(catalog);
  assert.equal(text.includes("api.example.test"), false);
  assert.equal(text.toLowerCase().includes("api_key"), false);
  assert.equal(text.includes("ciphertext"), false);
});

test("a missing Adrian credential blocks selection even if stale Kimi evidence exists", () => {
  const [entry] = buildKimiProviderCatalog([{ ...provider, hasKey: false }], [evidence()]);
  assert.equal(entry?.models[0]?.readiness, "BLOCKED");
  assert.deepEqual(selectVerifiedKimiProvider([entry!], { providerId: "provider-a", model: "model-a" }), {
    ok: false,
    error: "The selected provider has no saved credential.",
  });
});

test("a failed or partial check cannot be treated as ready", () => {
  const failed = buildKimiProviderCatalog([provider], [evidence({ checks: { ...checks, cancellation: "failed" } })]);
  assert.equal(failed[0]?.models[0]?.readiness, "BLOCKED");
  const partial = buildKimiProviderCatalog([provider], [evidence({ checks: { ...checks, usage: "not_run" } })]);
  assert.equal(partial[0]?.models[0]?.readiness, "PARTIAL");
});

test("selection is exact and never silently falls back to another model or provider", () => {
  const catalog = buildKimiProviderCatalog([provider], [evidence()]);
  assert.deepEqual(selectVerifiedKimiProvider(catalog, { providerId: "provider-a", model: "model-a" }), {
    ok: true,
    selection: { providerId: "provider-a", model: "model-a" },
  });
  assert.equal(selectVerifiedKimiProvider(catalog, { providerId: "provider-a", model: "model-b" }).ok, false);
  assert.equal(selectVerifiedKimiProvider(catalog, { providerId: "missing", model: "model-a" }).ok, false);
});

test("non-Kimi and malformed evidence cannot elevate a provider to verified", () => {
  const nonKimi = buildKimiProviderCatalog([provider], [evidence({ runtime: "other-runtime" })]);
  assert.equal(nonKimi[0]?.models[0]?.readiness, "NOT_AUDITED");
  const malformed = buildKimiProviderCatalog([provider], [evidence({ checks: { ...checks, auth: "partial" as "not_run" } })]);
  assert.equal(malformed[0]?.models[0]?.readiness, "NOT_AUDITED");
});
