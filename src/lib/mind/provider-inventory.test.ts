import assert from "node:assert/strict";
import { test } from "node:test";
import { providerInventory } from "./provider-inventory.ts";
import type { EnvironmentModelCatalog } from "./environment-model-catalog.ts";
import type { UsageEntry } from "./types.ts";

test("configured and listed models keep adapter and exact execution evidence separate", () => {
  const catalog: EnvironmentModelCatalog = {
    provider: "gemini", state: "catalogued", configured: true, discoverySupported: true, checkedAt: "2026-11-27", expiresAt: "2026-11-28", error: null, inferenceVerified: false,
    models: ["fixture-model", "other-model"], capabilities: { "fixture-model": { imageInput: "unsupported", source: "catalogue", reasoningLevels: [] } },
  };
  const answer: UsageEntry = { id: "answer", stage: "answer", chatId: "chat", at: "2026-11-27", provider: "Gemini", model: "other-model", requestId: "fixture-receipt", promptTokens: null, completionTokens: null, kind: "actual", outcome: "completed", providerDispatch: "sent" };
  const input = { catalogs: [catalog], configured: { grok: true }, choices: [{ id: "gemini", enabled: true }], custom: [], selected: "gemini", models: { gemini: "fixture-model" }, usage: [answer] };
  const now = Date.parse("2026-11-27T18:00:00Z");
  const gemini = (value: typeof input, point = now) => providerInventory(value, point).find(item => item.id === "gemini")!;
  const row = gemini(input);
  assert.equal(row.configuration, "Configured");
  assert.equal(row.selection, "Selected for Chat");
  assert.equal(row.discovery, "2 listed models");
  assert.equal(row.capabilities.Vision, "Unsupported");
  assert.equal(row.capabilities["Realtime audio"], "Unsupported");
  assert.match(row.evidence, /No confirmed/);
  const exact = { ...answer, model: "fixture-model" };
  assert.match(gemini({ ...input, usage: [exact] }).evidence, /Confirmed answer receipt · fixture-model/);
  assert.match(gemini({ ...input, usage: [{ ...exact, requestId: null }] }).evidence, /No confirmed/);
  assert.equal(gemini({ ...input, choices: [] }).selection, "Selected route unavailable");
  assert.equal(gemini(input, now + 24 * 60 * 60 * 1_000).discovery, "Catalogue stale");
});
