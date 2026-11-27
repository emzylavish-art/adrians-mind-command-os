import assert from "node:assert/strict";
import test from "node:test";
import { consumeMindTurn } from "./live-turn.ts";
import { turnErrorCode, providerErrorCode } from "./turn-error.ts";
import { failureKindForAction } from "./recovery-inbox.ts";

const consume = (response: Response) => consumeMindTurn({ url: "/fixture", body: {}, headers: {}, signal: new AbortController().signal, onDelta: () => {}, fetchImpl: async () => response });

test("same machine error with different wording selects the same recovery kind", async () => {
  for (const message of ["Too many requests", "Please wait for the next window", "Synthetic localized copy unrelated to limits"]) {
    const result = await consume(Response.json({ ok: false, code: "rate_limited", error: message }, { status: 409 }));
    assert.equal(result.ok, false); if (result.ok) continue;
    assert.equal(result.code, "rate_limited"); assert.equal(failureKindForAction(result.code!), "rate_limited");
  }
});

test("HTTP fallback preserves only known status semantics and never fabricates a provider cause", async () => {
  for (const [status, expected] of [[401, "auth_required"], [429, "rate_limited"], [503, "service_unavailable"], [403, "unknown"], [409, "unknown"]] as const) {
    const result = await consume(Response.json({ error: "A message without diagnostic keywords" }, { status }));
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, expected);
  }
  assert.equal(turnErrorCode("made_up_failure"), "unknown");
  assert.equal(providerErrorCode(401), "provider_credentials_rejected");
  assert.equal(providerErrorCode(402), "billing_required");
});

test("typed SSE failures survive parsing independently of message wording", async () => {
  const stream = await consume(new Response('event: error\ndata: {"error":"Different wording","code":"model_unavailable"}\n\n', { headers: { "content-type": "text/event-stream" } }));
  assert.equal(stream.ok, false); if (!stream.ok) assert.equal(stream.code, "model_unavailable");
  const unknown = await consume(new Response('event: error\ndata: {"error":"Sign in is required but this is untrusted copy","code":"unknown"}\n\n', { headers: { "content-type": "text/event-stream" } }));
  assert.equal(unknown.ok, false); if (!unknown.ok) assert.equal(unknown.code, "unknown");
});
