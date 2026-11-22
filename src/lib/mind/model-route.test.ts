import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NEMOTRON_MODEL, routeSelectedModel } from "./provider-call.ts";

describe("selected model routing", () => {
  it("returns the OpenRouter Nemotron reply and does not call Grok", async () => {
    const urls: string[] = [];
    const result = await routeSelectedModel({
      id: "nemotron",
      prompt: "Name the routed model.",
      env: { OPENROUTER_API_KEY: "test-openrouter-key" },
      fetch: async (url, init) => {
        urls.push(url);
        const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
        assert.equal(body.model, NEMOTRON_MODEL);
        assert.match(String((init?.headers as Record<string, string>).authorization), /test-openrouter-key/);
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "Routed reply from Nemotron." } }] }) };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.text, "Routed reply from Nemotron.");
    assert.equal(result.model, NEMOTRON_MODEL);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /openrouter.ai/);
    assert.equal(urls.some((url) => url.includes("x.ai")), false);
  });

  it("returns the local runner reply and does not call Grok", async () => {
    const result = await routeSelectedModel({
      id: "ollama",
      prompt: "Say local.",
      env: { LOCAL_MODEL_URL: "http://127.0.0.1:9400/generate" },
      fetch: async (url, init) => {
        assert.equal(url, "http://127.0.0.1:9400/generate");
        assert.match(String(init?.body), /Say local/);
        return { ok: true, status: 200, text: async () => JSON.stringify({ text: "Routed reply from the local model." }) };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.text, "Routed reply from the local model.");
    assert.equal(result.model, "ollama");
  });

  it("refuses a missing runner without substituting Grok", async () => {
    let called = false;
    const missing = await routeSelectedModel({
      id: "nemotron",
      prompt: "hello",
      env: {},
      fetch: async () => { called = true; return { ok: true, status: 200, text: async () => "nope" }; },
    });
    assert.equal(called, false);
    assert.equal(missing.ok, false);
    assert.match(missing.error, /Grok was not substituted/);
    const local = await routeSelectedModel({
      id: "ollama",
      prompt: "hello",
      env: {},
      fetch: async () => { called = true; return { ok: true, status: 200, text: async () => "nope" }; },
    });
    assert.equal(called, false);
    assert.match(local.error, /Grok was not substituted/);
  });
});
