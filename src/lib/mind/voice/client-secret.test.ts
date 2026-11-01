import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mintRealtimeClientSecret } from "./client-secret.ts";

describe("mintRealtimeClientSecret", () => {
  it("refuses when no voice key is configured", async () => {
    const result = await mintRealtimeClientSecret({ env: {} });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /No speech key/);
  });

  it("returns the ephemeral value from a mocked xAI response without exposing the management key", async () => {
    const result = await mintRealtimeClientSecret({
      env: { XAI_VOICE_API_KEY: "xai-test-voice-key-not-real" },
      fetchImpl: async (_url, init) => {
        const auth = String((init?.headers as Record<string, string>)?.Authorization || "");
        assert.match(auth, /^Bearer xai-test-voice-key-not-real$/);
        return new Response(JSON.stringify({ value: "xai-realtime-client-secret-test", expires_at: 123 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value, "xai-realtime-client-secret-test");
      assert.equal(result.expiresAt, 123);
    }
  });
});
