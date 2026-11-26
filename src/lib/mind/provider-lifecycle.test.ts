import assert from "node:assert/strict";
import { test } from "node:test";
import { implementedProviderCapabilities, preserveProviderModel, providerRestriction, providerRetryAt } from "./provider-lifecycle.ts";
import { customProviderBlockReason } from "./provider-catalog.ts";

test("catalog refresh preserves a disappeared selected model until explicit selection", () => {
  assert.deepEqual(preserveProviderModel("chosen", ["other"]), { model: "chosen", available: false });
  assert.deepEqual(preserveProviderModel("", ["first"]), { model: "first", available: true });
});

test("billing and throttling have different explicit recovery contracts", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(providerRestriction(402), "billing_required"); assert.equal(providerRestriction(429), "rate_limited");
  assert.equal(providerRetryAt("120", now), "2026-01-01T00:02:00.000Z");
  assert.match(customProviderBlockReason({ hasKey: true, status: "billing_required" })!, /billing/i);
  assert.equal(customProviderBlockReason({ hasKey: true, status: "rate_limited", retryAt: "2020-01-01T00:00:00Z" }), null);
  assert.equal(customProviderBlockReason({ hasKey: true, status: "rate_limited", retryAt: "2099-01-01T00:00:00Z", rateLimitedModel: "one", model: "two" }), null);
});

test("text answers do not imply speech, vision, or successful inference", () => {
  assert.equal(implementedProviderCapabilities("generativelanguage.googleapis.com").answer, "implemented");
  assert.equal(implementedProviderCapabilities("generativelanguage.googleapis.com").speech, "not_wired");
  assert.equal(implementedProviderCapabilities("custom.example").speech, "unknown");
});
