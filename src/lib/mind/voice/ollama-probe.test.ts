import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { probeOllama } from "./ollama-probe.ts";

describe("probeOllama", () => {
  it("returns a clear hint when fetch fails", async () => {
    const result = await probeOllama({
      baseUrl: "http://127.0.0.1:11434",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.hint, "Ollama not reachable");
      assert.match(result.error, /Orchestrator needs Ollama/);
      assert.match(result.error, /11434/);
    }
  });

  it("returns ok on a 200 tags response", async () => {
    const result = await probeOllama({
      fetchImpl: async () => new Response(JSON.stringify({ models: [] }), { status: 200 }),
    });
    assert.equal(result.ok, true);
  });
});
