import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mintRealtimeClientSecret } from "./client-secret.ts";

describe("mintRealtimeClientSecret", () => {
  it("refuses when no voice key is configured", async () => {
    const result = await mintRealtimeClientSecret({ env: {}, secretsPath: "/tmp/amcos-missing-voice-secrets.env" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /No speech key/);
  });

  it("returns the ephemeral value from a mocked xAI response without exposing the management key", async () => {
    const result = await mintRealtimeClientSecret({
      env: { XAI_VOICE_API_KEY: "xai-test-voice-key-not-real" },
      fetchImpl: async (_url, init) => {
        const auth = String((init?.headers as Record<string, string>)?.Authorization || "");
        assert.match(auth, /^Bearer xai-test-voice-key-not-real$/);
        const body = JSON.parse(String(init?.body || "{}")) as { expires_after?: { seconds?: number }; session?: unknown };
        assert.equal(body.session, undefined);
        assert.equal(body.expires_after?.seconds, 300);
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


  it("handles non-JSON 200 with an honest error", async () => {
    const result = await mintRealtimeClientSecret({
      env: { XAI_VOICE_API_KEY: "xai-test-voice-key-not-real" },
      fetchImpl: async () =>
        new Response("not-json{", { status: 200, headers: { "content-type": "text/plain" } }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /could not be read/i);
  });

  it("refuses missing expires_at instead of falling back to 0", async () => {
    const result = await mintRealtimeClientSecret({
      env: { XAI_VOICE_API_KEY: "xai-test-voice-key-not-real" },
      fetchImpl: async () =>
        new Response(JSON.stringify({ value: "xai-realtime-client-secret-test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /no expiry/i);
  });
});
