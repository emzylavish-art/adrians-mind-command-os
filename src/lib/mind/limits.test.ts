import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkTurnSize, takeToken } from "./limits.ts";

describe("mind request limits", () => {
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
    assert.equal(checkTurnSize({ text: "ok", history: Array.from({ length: 13 }, () => ({ content: "a" })), memoryContext: [] }).ok, false);
  });
});

describe("checkTurnSize images", () => {
  it("rejects oversized image payloads", () => {
    const big = "data:image/png;base64," + "a".repeat(2_800_000);
    const result = checkTurnSize({ text: "hi", history: [], memoryContext: [], images: [{ dataUrl: big }] });
    assert.equal(result.ok, false);
  });
});
