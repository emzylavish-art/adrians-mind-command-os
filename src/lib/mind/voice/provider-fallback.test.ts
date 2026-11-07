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
      assert.equal(openaiStatus, 200);
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
  it("uses OpenAI STT, TTS, and chat when xAI returns 400", async () => {
    const stt = scriptedFetch(200);
    const heard = await transcribeWithFallback({
      bytes: new Uint8Array([1, 2, 3, 4]),
      xaiKey: XAI,
      openaiKey: OPENAI,
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
    const spoken = await speakWithFallback({ text: "It is sunny.", xaiKey: XAI, openaiKey: OPENAI, fetchImpl: tts.fetchImpl });
    assert.equal(spoken.ok, true);
    if (spoken.ok) assert.equal(spoken.provider, "OpenAI");
    assert.ok(tts.seen.some((url) => url.includes("/audio/speech")));

    const chat = scriptedFetch(200);
    const reply = await directChatWithFallback({
      messages: [{ role: "user", content: "what is the weather" }],
      xaiKey: XAI,
      openaiKey: OPENAI,
      fetchImpl: chat.fetchImpl,
    });
    assert.equal(reply.ok, true);
    if (reply.ok) {
      assert.equal(reply.provider, "OpenAI");
      assert.equal(reply.model, "gpt-4o-mini");
      assert.equal(reply.text, "It is sunny.");
    }
    for (const result of [heard, spoken, reply]) {
      assert.equal(JSON.stringify(result).includes(XAI), false);
      assert.equal(JSON.stringify(result).includes(OPENAI), false);
    }
  });

  it("returns an honest error when xAI and OpenAI both fail", async () => {
    for (const run of [
      () => transcribeWithFallback({ bytes: new Uint8Array([1, 2, 3]), xaiKey: XAI, openaiKey: OPENAI, fetchImpl: scriptedFetch(500).fetchImpl }),
      () => speakWithFallback({ text: "Hello", xaiKey: XAI, openaiKey: OPENAI, fetchImpl: scriptedFetch(500).fetchImpl }),
      () =>
        directChatWithFallback({
          messages: [{ role: "user", content: "Hello" }],
          xaiKey: XAI,
          openaiKey: OPENAI,
          fetchImpl: scriptedFetch(500).fetchImpl,
        }),
    ]) {
      const result = await run();
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /xAI failed and OpenAI failed/);
        assert.equal(result.error.includes(XAI), false);
        assert.equal(result.error.includes(OPENAI), false);
        assert.equal(result.provider, null);
      }
    }
  });
});
