import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogCapabilities, imageCapabilityBlockReason, modelCapabilities, readModelCapabilityRegistry } from "./model-capabilities.ts";

test("models sharing a provider retain distinct declared image capabilities", () => {
  const capabilities = catalogCapabilities("openrouter.ai", [
    { id: "fixture/vision:free", architecture: { input_modalities: ["text", "image"] } },
    { id: "fixture/text:free", architecture: { input_modalities: ["text"] } },
  ], ["fixture/vision:free", "fixture/text:free"]);
  assert.equal(imageCapabilityBlockReason("openrouter.ai", "fixture/vision:free", capabilities), null);
  assert.match(imageCapabilityBlockReason("openrouter.ai", "fixture/text:free", capabilities)!, /text-only/);
  assert.match(imageCapabilityBlockReason("openrouter.ai", "unlisted", capabilities)!, /unconfirmed/);
});

test("unknown custom models do not inherit a provider capability; known profiles are declarations only", () => {
  assert.equal(modelCapabilities("api.openai.com", "synthetic-text-model").imageInput, "unknown");
  assert.equal(modelCapabilities("api.openai.com", "gpt-4.1").source, "adapter_profile");
  assert.equal(modelCapabilities("custom.example", "gpt-4.1").imageInput, "unknown");
});

test("catalogue limits retain total context and independent input/output caps without guessing model sizes", () => {
  const registry = catalogCapabilities("openrouter.ai", [{ id: "fixture", context_length: 8192, top_provider: { max_completion_tokens: 2048 } }], ["fixture"]);
  assert.equal(registry.fixture.contextWindowTokens, 8192); assert.equal(registry.fixture.maxOutputTokens, 2048);
  const gemini = modelCapabilities("generativelanguage.googleapis.com", "models/fixture", { inputTokenLimit: 32000, outputTokenLimit: 4000 });
  assert.equal(gemini.maxInputTokens, 32000); assert.equal(gemini.maxOutputTokens, 4000); assert.equal(gemini.contextWindowTokens, undefined);
  assert.deepEqual(readModelCapabilityRegistry(JSON.stringify({ fixture: gemini })).fixture, gemini);
  assert.equal(modelCapabilities("api.openai.com", "gpt-4.1").contextWindowTokens, undefined);
  assert.equal(modelCapabilities("fixture", "fixture", { context_length: "8192", outputTokenLimit: -1 }).limitsSource, undefined);
});
