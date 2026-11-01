import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callXaiChat, readXaiApiKey } from "./xai-adapter.ts";

describe("xai adapter", () => {
  it("returns unavailable missing_key with no fabricated reply when XAI_API_KEY is unset", async () => {
    const keyed = readXaiApiKey({});
    assert.equal(keyed.ok, false);
    if (keyed.ok) return;
    assert.equal(keyed.state, "unavailable");
    assert.equal(keyed.reason, "missing_key");
    assert.equal(keyed.text, "");
    assert.match(keyed.error, /unavailable|missing/i);

    let called = false;
    const result = await callXaiChat({
      prompt: "Reply with exactly: VERIFY-OK",
      env: {},
      fetchImpl: async () => {
        called = true;
        return new Response(JSON.stringify({ choices: [{ message: { content: "fabricated" } }] }), { status: 200 });
      },
    });
    assert.equal(called, false);
    assert.equal(result.ok, false);
    assert.equal(result.state, "unavailable");
    if (!result.ok) assert.equal(result.reason, "missing_key");
    assert.equal(result.text, "");
    assert.match(result.error, /Nothing was sent|Nothing was persisted/i);
  });

  it("reports api_error without inventing text when xAI rejects the key", async () => {
    const result = await callXaiChat({
      prompt: "Reply with exactly: VERIFY-OK",
      env: { XAI_API_KEY: "xai-test-invalid" },
      fetchImpl: async () =>
        new Response(JSON.stringify({ code: "invalid-argument", error: "Incorrect API key provided." }), {
          status: 400,
          headers: { "x-request-id": "req-test" },
        }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, "unavailable");
    if (!result.ok) assert.equal(result.reason, "api_error");
    assert.equal(result.text, "");
    assert.equal(result.status, 400);
    assert.equal(result.requestId, "req-test");
    assert.match(result.error, /Nothing was persisted/);
  });
});
