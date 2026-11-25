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
  it("allows copy controls but does not embed a literal key or secret input", async () => {
    const panel = await readFile(new URL("../../components/mind/safe-keys-panel.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(panel, /<input|<textarea|type=["']password/i);
    assert.doesNotMatch(panel, /xai-/);
    assert.match(panel, /SAFE_KEY_CAPABILITIES/);
    assert.match(panel, /safeKeyStatus\(capability.id/);
    assert.match(panel, /Account model providers/);
    assert.match(panel, /onCopy/);
  });
});
