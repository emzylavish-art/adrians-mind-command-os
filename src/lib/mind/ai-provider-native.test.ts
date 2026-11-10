import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  providerWireProtocol, modelDiscoveryHeaders, buildProviderChatRequest,
  parseProviderText,
} from "./ai-provider-native.ts";

const turns = [
  { role: "system" as const, content: "Be precise." },
  { role: "user" as const, content: "Hello" },
];
describe("native BYOK provider request formats", () => {
  it("classifies only exact known API hostnames", () => {
    assert.equal(providerWireProtocol("https://api.anthropic.com/v1"), "anthropic");
    assert.equal(providerWireProtocol("https://generativelanguage.googleapis.com/v1beta"), "gemini");
    assert.equal(providerWireProtocol("https://api.anthropic.com.attacker.example/v1"), "openai");
    assert.equal(providerWireProtocol("https://api.openai.com/v1"), "openai");
  });
  it("uses native Anthropic headers and messages", () => {
    assert.equal(modelDiscoveryHeaders("anthropic", "test-key")["x-api-key"], "test-key");
    const request = buildProviderChatRequest("anthropic", "key", "claude-sonnet-4-5", turns);
    const data = JSON.parse(request.body);
    assert.equal(request.path, "messages");
    assert.equal(data.max_tokens, 2048);
    assert.equal(data.system, "Be precise.");
    assert.deepEqual(data.messages, [{ role: "user", content: "Hello" }]);
    assert.equal(JSON.stringify(data).includes("key"), false);
  });
  it("uses native Gemini headers, model paths and role mapping", () => {
    const req = buildProviderChatRequest("gemini", "key", "models/gemini-2.5-flash", [...turns, { role: "assistant", content: "Hi" }]);
    assert.equal(req.path, "models/gemini-2.5-flash:generateContent");
    assert.equal(req.headers["x-goog-api-key"], "key");
    const body = JSON.parse(req.body);
    assert.equal(body.systemInstruction.parts[0].text, "Be precise.");
    assert.deepEqual(body.contents.map((m: {role: string}) => m.role), ["user", "model"]);
  });
  it("preserves OpenAI-compatible model invocation", () => {
    const req = buildProviderChatRequest("openai", "key", "model-a", turns);
    assert.equal(req.path, "chat/completions");
    assert.equal(JSON.parse(req.body).model, "model-a");
    assert.equal(req.headers.authorization, "Bearer key");
  });
});
describe("native BYOK provider response formats", () => {
  it("parses text and token usage from Anthropic", () => {
    const result = parseProviderText("anthropic", JSON.stringify({
      content: [{ type: "text", text: "Answer" }], usage: { input_tokens: 25, output_tokens: 12 },
    }));
    assert.deepEqual(result, { ok: true, text: "Answer", usage: { prompt_tokens: 25, completion_tokens: 12 } });
  });
  it("parses text and usage from Gemini", () => {
    const result = parseProviderText("gemini", JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Hello" }] } }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2 },
    }));
    assert.deepEqual(result, { ok: true, text: "Hello", usage: { prompt_tokens: 8, completion_tokens: 2 } });
  });
  it("rejects tool requests for all providers before any tool executes", () => {
    for (const [kind, body] of [
      ["anthropic", { content: [{ type: "tool_use", id: "tool1" }] }],
      ["gemini", { candidates: [{ content: { parts: [{ functionCall: { name: "unsafe" } }] } }] }],
      ["openai", { choices: [{ message: { tool_calls: [{ function: { name: "unsafe" } }] } }] }],
    ] as const) {
      const result = parseProviderText(kind, JSON.stringify(body));
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /not enabled/);
    }
  });
  it("does not hallucinate text for empty or malformed responses", () => {
    assert.equal(parseProviderText("anthropic", "{}").ok, false);
    assert.equal(parseProviderText("gemini", "not-json").ok, false);
    assert.equal(parseProviderText("openai", "{}").ok, false);
  });
});
