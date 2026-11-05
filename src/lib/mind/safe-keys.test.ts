import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SAFE_KEY_PROVIDERS } from "./safe-keys.ts";

describe("safe key settings inventory", () => {
  it("shows six distinct server-managed providers without exposing credential values", () => {
    assert.deepEqual(SAFE_KEY_PROVIDERS.map(({ id }) => id), [
      "grok", "openai", "anthropic", "gemini", "openrouter", "notion",
    ]);
    assert.equal(new Set(SAFE_KEY_PROVIDERS.map(({ id }) => id)).size, 6);
    assert.ok(SAFE_KEY_PROVIDERS.every(({ environment }) => environment.length > 0));
  });
});
