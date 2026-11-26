import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkTurnSize, takeToken, consumeMindRateLimit, resetMindRateLimitsForTests } from "./limits.ts";

describe("mind request limits", () => {
  it("retains a long-window quota when a short-window request prunes stale buckets", () => {
    resetMindRateLimitsForTests();
    assert.equal(consumeMindRateLimit("daily", "owner", 1, 86_400_000, 0).ok, true);
    assert.equal(consumeMindRateLimit("chat", "other", 12, 60_000, 120_000).ok, true);
    assert.equal(consumeMindRateLimit("daily", "owner", 1, 86_400_000, 120_001).ok, false);
    assert.equal(consumeMindRateLimit("daily", "owner", 1, 86_400_000, 86_400_000).ok, true);
  });
  it("stops a caller after the limit inside the window", () => {
    const state = new Map<string, number[]>();
    assert.equal(takeToken(state, "chat:a", 2, 1000, 0), true);
    assert.equal(takeToken(state, "chat:a", 2, 1000, 10), true);
    assert.equal(takeToken(state, "chat:a", 2, 1000, 20), false);
    assert.equal(takeToken(state, "chat:b", 2, 1000, 20), true);
    assert.equal(takeToken(state, "chat:a", 2, 1000, 1200), true);
  });

  it("rejects oversized turns", () => {
    assert.equal(checkTurnSize({ text: "ok", history: [], memoryContext: [] }).ok, true);
    assert.equal(checkTurnSize({ text: "x".repeat(8001), history: [], memoryContext: [] }).ok, false);
    assert.equal(checkTurnSize({ text: "ok", history: Array.from({ length: 13 }, () => ({ content: "a" })), memoryContext: [] }).ok, true);
    assert.equal(checkTurnSize({ text: "ok", history: [{ content: "x".repeat(20000) }], memoryContext: [] }).ok, true);
    assert.equal(checkTurnSize({ text: "ok", history: Array.from({ length: 10001 }, () => ({ content: "a" })), memoryContext: [] }).ok, false);
  });
});

describe("checkTurnSize images", () => {
  it("rejects oversized image payloads", () => {
    const big = "data:image/png;base64," + "a".repeat(2_800_000);
    const result = checkTurnSize({ text: "hi", history: [], memoryContext: [], images: [{ dataUrl: big }] });
    assert.equal(result.ok, false);
  });
});
