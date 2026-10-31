import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertLiveProvider, resolveProvider } from "./providers.ts";

describe("provider routing", () => {
  it("keeps Grok when it is the explicit choice", () => {
    const resolved = resolveProvider("grok", false);
    assert.equal(resolved.ok && resolved.model, "grok-4.5");
  });

  it("does not substitute Grok when another provider is chosen", () => {
    const resolved = resolveProvider("openai", true);
    assert.equal(resolved.ok, false);
    if (!resolved.ok) assert.match(resolved.error, /not substituted/);
  });

  it("treats a missing provider as Grok and refuses a named other provider", () => {
    const missing = assertLiveProvider(undefined);
    assert.equal(missing.ok, true);
    if (missing.ok) assert.equal(missing.model, "grok-4.5");
    const refused = assertLiveProvider("anthropic");
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.error, /not substituted/);
    assert.equal(assertLiveProvider(4).ok, false);
  });
});
