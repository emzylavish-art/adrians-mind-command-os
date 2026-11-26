import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankCatalogModels } from "./provider-catalog.ts";

describe("rankCatalogModels", () => {
  it("puts zero-price text models first and keeps the rest", () => {
    const ranked = rankCatalogModels([
      { id: "paid/one", pricing: { prompt: "0.000001", completion: "0.000002" }, architecture: { output_modalities: ["text"] } },
      { id: "free/text", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["text"] } },
      { id: "free/image", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["image"] } },
      "manual/kept",
    ]);
    assert.deepEqual(ranked, ["free/text", "paid/one", "free/image", "manual/kept"]);
  });

  it("does not stop at 120 models", () => {
    const found = Array.from({ length: 130 }, (_, index) => `vendor/model-${index}`);
    const ranked = rankCatalogModels(found);
    assert.equal(ranked.length, 130);
    assert.equal(ranked[129], "vendor/model-129");
  });

  it("keeps an OpenRouter alias that starts with a tilde", () => {
    const ranked = rankCatalogModels(["paid/one", "~openai/gpt-astra-latest"]);
    assert.deepEqual(ranked, ["paid/one", "~openai/gpt-astra-latest"]);
  });
});

it("C2 AA109: unknown and malformed prices never become zero-cost models", async () => {
  const { isFreeTextModel } = await import("./provider-catalog.ts");
  for (const value of [null, undefined, "", " ", false, true, {}, [], "0x0", "NaN", -1, Infinity]) {
    assert.equal(isFreeTextModel({ id: "x", pricing: { prompt: value, completion: value }, architecture: { output_modalities: ["text"] } }), false, String(value));
  }
  for (const value of [0, "0", "0.0", "0e0"]) assert.equal(isFreeTextModel({ pricing: { prompt: value, completion: value }, architecture: { output_modalities: ["text"] } }), true);
});

it("C2 AA110–113: profiles retain metadata and explicit routing rejects incompatible known capabilities", async () => {
  const { normalizeCatalogModels, modelCompatibility, discoveredCapabilities } = await import("./provider-catalog.ts");
  const [profile] = normalizeCatalogModels([{ id: "vendor/text", context_length: 8192, pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["tools"] }]);
  assert.equal(profile.contextTokens, 8192);
  assert.equal(profile.supportsTools, true);
  assert.equal(profile.supportsStructuredOutput, false);
  assert.equal(modelCompatibility(profile, { structuredOutput: true }).compatible, false);
  assert.deepEqual(normalizeCatalogModels(JSON.parse(JSON.stringify([profile]))), [profile]);
  assert.equal(modelCompatibility(profile, { input: ["image"] }).compatible, false);
  assert.equal(modelCompatibility(profile, { estimatedInputTokens: 9000 }).compatible, false);
  assert.equal(modelCompatibility(undefined, { freeOnly: true }).compatible, false);
  assert.equal(modelCompatibility(undefined, { input: ["image"] }).compatible, false);
  assert.equal(modelCompatibility(undefined, { tools: true }).compatible, false);
  assert.equal(modelCompatibility(undefined, { structuredOutput: true }).compatible, false);
  assert.equal(modelCompatibility(undefined, { input: ["text"] }).compatible, true);
  assert.equal(modelCompatibility({ ...profile, inputModalities: [] }, { input: ["audio"] }).compatible, false);
  assert.equal(modelCompatibility(profile, { freeOnly: true, tools: true }).compatible, true);
  const found = discoveredCapabilities({ models: [{ id: "12345678-1234-4234-8234-123456789abc", label: "API", models: [profile.id], modelProfiles: [{ ...profile, lastExecution: { outcome: "rate_limited", at: "2026-11-25T00:00:00Z", requestedModel: profile.id } }], hasKey: true, status: "configured" }], mcp: [{ id: "tools", label: "Tools", state: "connected", tools: [{ name: "read_file", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] }] });
  assert.equal(found[0].readiness, "last_call_failed");
  assert.match(found[0].reason, /rate limited/);
  assert.equal(found[0].model?.contextTokens, 8192);
  assert.equal(found[1].tool?.readOnly, true);
});
