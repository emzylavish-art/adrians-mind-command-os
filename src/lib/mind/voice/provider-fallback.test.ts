import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { directChatWithFallback, speakWithFallback, transcribeWithFallback } from "./provider-fallback.ts";

const XAI = "xai-test-secret-value";
const OPENAI = "sk-test-openai-secret-value";

function scriptedFetch(openaiStatus: number) {
  const seen: string[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    seen.push(href);
    if (href.includes("api.x.ai")) {
      return new Response(JSON.stringify({ error: `Incorrect API key provided: ${XAI}` }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.includes("/audio/speech")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "gpt-4o-mini-tts");
      assert.equal(body.voice, "alloy");
      if (openaiStatus !== 200) return Response.json({ error: "fixture unavailable" }, { status: openaiStatus });
      return new Response(new Uint8Array(64).fill(7), { status: openaiStatus });
    }
    if (href.includes("/audio/transcriptions")) {
      return new Response(JSON.stringify({ text: openaiStatus === 200 ? "what is the weather" : "" }), {
        status: openaiStatus,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.includes("api.openai.com/v1/chat/completions")) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "gpt-4o-mini");
      return new Response(
        JSON.stringify(openaiStatus === 200 ? { choices: [{ message: { content: "It is sunny." } }] } : { error: "no" }),
        { status: openaiStatus, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("missing", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

describe("voice provider fallback", () => {
  it("does not call OpenAI or hide the xAI voice error without explicit fallback", async () => {
    const tts = scriptedFetch(200);
    const spoken = await speakWithFallback({
      text: "This should use Eve only.", voiceId: "eve",
      xaiKey: XAI, fetchImpl: tts.fetchImpl,
    });
    assert.equal(spoken.ok, false);
    if (!spoken.ok) {
      assert.match(spoken.error, /Voice returned 400/);
      assert.equal(spoken.provider, null);
    }
    assert.equal(tts.seen.length, 1);
    assert.match(tts.seen[0], /api\.x\.ai/);
    assert.equal(tts.seen.some((url) => url.includes("api.openai.com")), false);
  });

  it("reports missing xAI speech configuration without trying an alternative", async () => {
    let called = false;
    const spoken = await speakWithFallback({
      text: "hello", voiceId: "eve",
      fetchImpl: (async () => { called = true; throw new Error("Unexpected request"); }) as typeof fetch,
    });
    assert.equal(spoken.ok, false);
    assert.equal(called, false);
    if (!spoken.ok) assert.match(spoken.error, /xAI voice is not configured/);
  });

  it("uses explicitly authorized OpenAI STT, TTS, and chat when xAI rejects the key", async () => {
    const stt = scriptedFetch(200);
    const heard = await transcribeWithFallback({
      bytes: new Uint8Array([1, 2, 3, 4]),
      policy: { provider: "xai", allowFallback: true },
      xaiKey: XAI,
      openaiKey: OPENAI, fallbackProvider: "openai",
      fetchImpl: stt.fetchImpl,
    });
    assert.equal(heard.ok, true);
    if (heard.ok) {
      assert.equal(heard.provider, "OpenAI");
      assert.equal(heard.text, "what is the weather");
    }
    assert.ok(stt.seen.some((url) => url.includes("api.x.ai/v1/stt")));
    assert.ok(stt.seen.some((url) => url.includes("/audio/transcriptions")));

    const tts = scriptedFetch(200);
    const spoken = await speakWithFallback({ text: "It is sunny.", xaiKey: XAI, openaiKey: OPENAI, fallbackProvider: "openai", fetchImpl: tts.fetchImpl });
    assert.equal(spoken.ok, true);
    if (spoken.ok) assert.equal(spoken.provider, "OpenAI");
    assert.ok(tts.seen.some((url) => url.includes("/audio/speech")));

    const chat = scriptedFetch(200);
    const reply = await directChatWithFallback({
      messages: [{ role: "user", content: "what is the weather" }],
      xaiKey: XAI,
      openaiKey: OPENAI, fallbackProvider: "openai",
      fetchImpl: chat.fetchImpl,
    });
    assert.equal(reply.ok, true);
    if (reply.ok) {
      assert.equal(reply.provider, "OpenAI");
      assert.equal(reply.model, "model unknown");
      assert.equal(reply.text, "It is sunny.");
    }
    for (const result of [heard, spoken, reply]) {
      assert.equal(JSON.stringify(result).includes(XAI), false);
      assert.equal(JSON.stringify(result).includes(OPENAI), false);
    }
  });

  it("returns an honest error when xAI and OpenAI both fail", async () => {
    for (const run of [
      () => transcribeWithFallback({ bytes: new Uint8Array([1, 2, 3]), policy: { provider: "xai", allowFallback: true }, xaiKey: XAI, openaiKey: OPENAI, fallbackProvider: "openai", fetchImpl: scriptedFetch(500).fetchImpl }),
      () => speakWithFallback({ text: "Hello", xaiKey: XAI, openaiKey: OPENAI, fallbackProvider: "openai", fetchImpl: scriptedFetch(500).fetchImpl }),
      () =>
        directChatWithFallback({
          messages: [{ role: "user", content: "Hello" }],
          xaiKey: XAI,
          openaiKey: OPENAI, fallbackProvider: "openai",
          fetchImpl: scriptedFetch(500).fetchImpl,
        }),
    ]) {
      const result = await run();
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /xAI and OpenAI did not produce a successful|OpenAI transcription returned 500/);
        assert.equal(result.error.includes(XAI), false);
        assert.equal(result.error.includes(OPENAI), false);
        assert.equal(result.provider, null);
      }
    }
  });
});

it("losing a dispatched response never repeats audio or voice chat on another provider", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url) => { calls.push(String(url)); throw new TypeError("fixture response lost"); };
  const shared = { xaiKey: XAI, openaiKey: OPENAI, fetchImpl, fallbackProvider: "openai" as const };
  assert.equal((await transcribeWithFallback({ ...shared, bytes: new Uint8Array([1, 2, 3]) })).ok, false);
  assert.equal((await speakWithFallback({ ...shared, text: "fixture" })).ok, false);
  assert.equal((await directChatWithFallback({ ...shared, messages: [{ role: "user", content: "fixture" }] })).ok, false);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(url => new URL(url).hostname === "api.x.ai"));
  const rejected = scriptedFetch(200);
  const reply = await directChatWithFallback({ messages: [{ role: "user", content: "fixture" }], xaiKey: XAI, openaiKey: OPENAI, fetchImpl: rejected.fetchImpl });
  assert.equal(reply.ok, false);
  assert.equal(rejected.seen.length, 1);
});
