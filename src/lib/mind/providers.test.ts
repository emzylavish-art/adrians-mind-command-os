import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertLiveProvider, chosenProvider, providerChoices, resolveProvider } from "./providers.ts";

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

  it("lets the owner choose only a configured provider", () => {
    assert.equal(providerChoices(true).filter((item) => item.enabled).map((item) => item.id).join(), "grok");
    assert.equal(providerChoices(false).some((item) => item.enabled), false);
    assert.equal(chosenProvider("openai", true).ok, false);
    assert.equal(chosenProvider("grok", true).ok, true);
    assert.equal(chosenProvider("grok", false).ok, false);
  });
});
