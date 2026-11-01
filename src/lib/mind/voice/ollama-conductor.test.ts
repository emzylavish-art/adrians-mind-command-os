import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OLLAMA_UNREACHABLE, probeOllamaConductor, runOllamaConductor } from "./ollama-conductor.ts";

describe("ollama conductor", () => {
  it("returns a clear unreachable error when fetch fails", async () => {
    const result = await runOllamaConductor("hello", {
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
});
