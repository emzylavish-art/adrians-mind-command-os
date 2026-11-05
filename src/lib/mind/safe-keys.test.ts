import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { SAFE_KEY_CAPABILITIES, SAFE_KEY_STATUS } from "./safe-keys.ts";

describe("Safe Keys capability inventory", () => {
  it("lists exactly the six separately scoped capabilities, not providers", () => {
    assert.deepEqual(SAFE_KEY_CAPABILITIES.map(({ id }) => id), ["voice", "chat", "image", "video", "code", "gpt"]);
    assert.equal(new Set(SAFE_KEY_CAPABILITIES.map(({ id }) => id)).size, 6);
    assert.equal(SAFE_KEY_CAPABILITIES.some(({ id }) => ["grok", "openai", "anthropic", "gemini", "openrouter", "notion"].includes(id)), false);
  });
  it("reports unavailable rather than configured while secure status is unverified", () => {
    assert.match(SAFE_KEY_STATUS, /not connected/i);
    assert.match(SAFE_KEY_STATUS, /configuration unavailable/i);
    assert.doesNotMatch(SAFE_KEY_STATUS, /configured/i);
  });
  it("keeps the UI free of secret-input, reveal, and copy controls", async () => {
    const panel = await readFile(new URL("./safe-keys-panel.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(panel, /<input|<textarea|type=["']password|reveal|copy/i);
    assert.match(panel, /SAFE_KEY_CAPABILITIES/);
    assert.match(panel, /SAFE_KEY_STATUS/);
  });
});
