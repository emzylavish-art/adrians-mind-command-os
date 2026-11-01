import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_OLLAMA_BASE, OLLAMA_UNREACHABLE, ollamaUnreachableMessage, probeOllamaConductor, runOllamaConductor } from "./ollama-conductor.ts";

describe("ollama conductor", () => {
  it("returns a clear unreachable error that names the URL", async () => {
    const result = await runOllamaConductor("hello", {
      baseUrl: "http://127.0.0.1:11434",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.unreachable, true);
      assert.match(result.error, /Orchestrator needs Ollama running locally/);
      assert.match(result.error, /http:\/\/127\.0\.0\.1:11434/);
      assert.match(result.error, /Switch Voice mode to Direct/);
      assert.equal(result.error, ollamaUnreachableMessage(DEFAULT_OLLAMA_BASE));
    }
  });

  it("includes a custom base URL in the unreachable message", async () => {
    const result = await runOllamaConductor("hello", {
      baseUrl: "http://192.168.1.10:11434/",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.unreachable, true);
      assert.equal(result.error, ollamaUnreachableMessage("http://192.168.1.10:11434"));
    }
  });

  it("returns conductor text from a mocked Ollama chat response", async () => {
    const result = await runOllamaConductor("say hi", {
      model: "mock-llama",
      fetchImpl: async () =>
        new Response(JSON.stringify({ model: "mock-llama", message: { content: "Hello there." } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.text, "Hello there.");
      assert.equal(result.model, "mock-llama");
    }
  });

  it("probe returns unreachable without crashing when Ollama is down", async () => {
    const result = await probeOllamaConductor({
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.unreachable, true);
      assert.equal(result.error, OLLAMA_UNREACHABLE);
    }
  });
  it("rejects a remote Ollama host with visible text (SSRF guard)", async () => {
    let called = false;
    const result = await probeOllamaConductor({
      baseUrl: "http://169.254.169.254/",
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    assert.equal(called, false);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /not allowed|localhost/i);
  });
});
