import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { browserWsProtocols, mintRealtimeClientSecret, realtimeWsUrl, transcribeWithXai } from "./realtime.ts";

describe("realtime voice helpers", () => {
  it("refuses to mint a client secret without XAI_API_KEY", async () => {
    const result = await mintRealtimeClientSecret({
      apiKey: undefined,
      fetch: (async () => {
        throw new Error("should not fetch");
      }) as typeof fetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /XAI_API_KEY/);
  });

  it("returns the documented websocket url and browser subprotocol prefix", () => {
    assert.equal(realtimeWsUrl(), "wss://api.x.ai/v1/realtime?model=grok-voice-latest");
    assert.deepEqual(browserWsProtocols("tok"), ["xai-client-secret.tok"]);
  });

  it("refuses provider STT without a key", async () => {
    const result = await transcribeWithXai({ apiKey: undefined, fetch: (async () => new Response()) as typeof fetch, bytes: new ArrayBuffer(0) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /fallback/i);
  });

  it("mints from a mocked endpoint without echoing the api key", async () => {
    const result = await mintRealtimeClientSecret({
      apiKey: "test-key-not-for-production",
      fetch: (async (_url, init) => {
        const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
        assert.match(auth, /^Bearer /);
        return new Response(JSON.stringify({ value: "xai-realtime-client-secret-test", expires_at: 1 }), { status: 200 });
      }) as typeof fetch,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.startsWith("xai-realtime-client-secret"), true);
  });
});
