import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callConfiguredProvider, configuredProviders, selectProvider, parseProviderText } from "./provider-call.ts";

describe("provider calls", () => {
  it("refuses a missing key without contacting a provider", async () => {
    let called = false;
    const selected = selectProvider("openai", {});
    assert.equal(selected.ok, false);
    const result = await callConfiguredProvider({
      id: "openai", key: "", prompt: "hello",
      fetch: async () => { called = true; return { ok: true, status: 200, text: async () => "nope" }; },
    });
    assert.equal(called, false);
    assert.match(result.error, /Nothing was sent/);
    assert.equal(configuredProviders({}).openai, false);
    assert.equal(selectProvider("grok", {}).ok, true);
  });
  it("reports a rate limit without substituting", async () => {
    const result = await callConfiguredProvider({
      id: "anthropic", key: "test-key", prompt: "hello",
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
  it("maps personality system instructions to each provider's native field", async () => {
    const inputs = [
      ["openai", "messages"],
      ["openrouter", "messages"],
      ["anthropic", "system"],
      ["gemini", "systemInstruction"],
    ] as const;
    for (const [id, field] of inputs) {
      let request: Record<string, unknown> | null = null;
      const result = await callConfiguredProvider({
        id, key: "test-key", prompt: "hello", systemPrompt: "Style preference only.",
        fetch: async (_url, init) => {
          request = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { ok: true, status: 200, text: async () => id === "gemini"
            ? JSON.stringify({ candidates: [{ content: { parts: [{ text: "reply" }] } }] })
            : id === "anthropic"
              ? JSON.stringify({ content: [{ type: "text", text: "reply" }] })
              : JSON.stringify({ choices: [{ message: { content: "reply" } }] }) };
        },
      });
      assert.equal(result.ok, true);
      assert.ok(request);
      if (field === "messages") {
        assert.deepEqual((request!.messages as unknown[])[0], { role: "system", content: "Style preference only." });
      } else if (field === "system") {
        assert.equal(request!.system, "Style preference only.");
        assert.deepEqual(request!.messages, [{ role: "user", content: "hello" }]);
      } else {
        assert.deepEqual(request!.systemInstruction, { parts: [{ text: "Style preference only." }] });
        assert.deepEqual(request!.contents, [{ role: "user", parts: [{ text: "hello" }] }]);
      }
    }
  });
  it("extracts assistant text from each provider response", () => {
    assert.equal(parseProviderText("openai", JSON.stringify({ choices: [{ message: { content: "hello" } }] })), "hello");
    assert.equal(parseProviderText("openrouter", JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "one" }] } }] })), "one");
    assert.equal(parseProviderText("anthropic", JSON.stringify({ content: [{ type: "text", text: "two" }] })), "two");
    assert.equal(parseProviderText("gemini", JSON.stringify({ candidates: [{ content: { parts: [{ text: "three" }] } }] })), "three");
    assert.equal(parseProviderText("openai", "not json"), "");
    assert.equal(parseProviderText("anthropic", JSON.stringify({ content: [{ type: "tool_use", input: { token: "secret" } }] })), "");
  });
  it("preserves recent conversation messages but not provider JSON", async () => {
    const result = await callConfiguredProvider({
      id: "openai", key: "key", prompt: "second", history: [{ role: "user", content: "first" }],
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body.messages, [{ role: "user", content: "first" }, { role: "user", content: "second" }]);
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "reply" } }] }) };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.text, "reply");
  });
});
