import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callConfiguredProvider, configuredProviders, selectProvider } from "./provider-call.ts";

describe("provider calls", () => {
  it("does not call a provider when its key is missing and does not switch to another", async () => {
    let called = false;
    const selected = selectProvider("openai", {});
    assert.equal(selected.ok, false);
    const result = await callConfiguredProvider({
      id: "openai",
      key: "",
      prompt: "hello",
      fetch: async () => {
        called = true;
        return { ok: true, status: 200, text: async () => "nope" };
      },
    });
    assert.equal(called, false);
    assert.match(result.error, /Nothing was sent/);
    assert.equal(configuredProviders({}).openai, false);
    assert.equal(selectProvider("grok", {}).ok, true);
  });

  it("sends the key only to that provider and reports a rate limit without substituting", async () => {
    const result = await callConfiguredProvider({
      id: "anthropic",
      key: "test-key",
      prompt: "hello",
      fetch: async (url, init) => {
        assert.match(url, /anthropic/);
        assert.equal((init?.headers as Record<string, string>)["x-api-key"], "test-key");
        return { ok: false, status: 429, text: async () => "" };
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /rate limited/);
    assert.equal(result.text, "");
  });
});
