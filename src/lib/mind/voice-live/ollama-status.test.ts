import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { probeOllamaForBadge } from "./ollama-status.ts";

describe("ollama badge probe", () => {
  it("surfaces a clear danger detail when Ollama is unreachable", async () => {
    const status = await probeOllamaForBadge({
      baseUrl: "http://127.0.0.1:9",
      fetchImpl: async () => {
        throw new Error("boom");
      },
    });
    assert.equal(status.ok, false);
    assert.equal(status.detailTone, "danger");
    assert.match(status.detail || "", /Ollama|unreachable|conductor/i);
  });

  it("returns ok with no detail when probe succeeds", async () => {
    const status = await probeOllamaForBadge({
      fetchImpl: async () =>
        new Response(JSON.stringify({ models: [{ name: "qwen2.5:0.5b" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    assert.equal(status.ok, true);
    assert.equal(status.detail, null);
  });
});
