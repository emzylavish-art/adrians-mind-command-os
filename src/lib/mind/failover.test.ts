import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  describeAnswer,
  extractProviderText,
  parseFailoverField,
  pickFallbackProvider,
  readFailoverPolicy,
  runFallback,
  sanitizeProviderError,
} from "./failover.ts";
import { relayModelStream, STOPPED_REPLY } from "./relay.ts";
import { consumeMindTurn } from "./live-turn.ts";
import { pullMindEvents } from "./stream.ts";

const XAI_KEY = "xai-PRIMARYSECRET123456";
const OPENAI_KEY = "sk-FALLBACKSECRET987654";
const ENV_WITH_OPENAI = { OPENAI_API_KEY: OPENAI_KEY };

function grokOk(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const grokFail = (status: number) => async () => new Response("upstream boom https://api.x.ai/v1/chat/completions " + XAI_KEY, { status });
const openaiOk = (text: string) => async (url: string) => {
  assert.match(url, /openai/);
  return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }) };
};
const openaiFail = (status: number) => async () => ({ ok: false, status, text: async () => "" });

async function events(res: Response) {
  return pullMindEvents(await res.text()).events;
}

function hook(env: Record<string, string>, fetchImpl: Parameters<typeof runFallback>[0]["fetch"], prompt = "hi") {
  let calls = 0;
  const fn = (error: string, signal: AbortSignal) => {
    calls++;
    return runFallback({ primary: "grok", primaryError: error, prompt, env, fetch: fetchImpl, signal, secrets: [XAI_KEY] });
  };
  return { fn, calls: () => calls };
}

const base = { apiKey: XAI_KEY, model: "primary-model", messages: [{ role: "user", content: "hi" }], usedIds: [] as string[] };

describe("failover OFF: errors surface, nothing substituted", () => {
  it("primary 503 → error event; fallback never called", async () => {
    let fallbackCalled = false;
    const res = relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: grokFail(503) as unknown as typeof fetch });
    const ev = await events(res);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].event, "error");
    assert.match((ev[0] as { error: string }).error, /returned 503/);
    assert.equal(fallbackCalled, false);
  });
  it("successful primary done event names provider grok and the real model", async () => {
    const res = relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: (async () => grokOk("hello")) as unknown as typeof fetch });
    const done = (await events(res)).find((e) => e.event === "done") as { provider?: string; model: string };
    assert.equal(done.provider, "grok");
    assert.equal(done.model, "primary-model");
  });
});

describe("failover ON: really retries through the request path", () => {
  it("primary 503 → fallback answers; done event reports the ACTUAL provider/model", async () => {
    const h = hook(ENV_WITH_OPENAI, openaiOk("from fallback"));
    const res = relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: grokFail(503) as unknown as typeof fetch, meta: { modelTier: "Expert", resolvedTier: "Expert" }, onUpstreamFailure: h.fn });
    const ev = await events(res);
    const done = ev.find((e) => e.event === "done") as Record<string, unknown>;
    assert.equal(h.calls(), 1);
    assert.equal(done.text, "from fallback");
    assert.equal(done.provider, "openai");
    assert.equal(done.model, "gpt-4.1-mini");
    assert.equal(done.failedOverFrom, "grok");
    assert.equal(done.resolvedTier, undefined, "fallback must not claim the primary tier resolved");
    assert.doesNotMatch(String(done.failoverReason), /PRIMARYSECRET|api\.x\.ai|https?:/);
  });
  it("consumeMindTurn (client) surfaces provider + failedOverFrom; describeAnswer names who answered", async () => {
    const h = hook(ENV_WITH_OPENAI, openaiOk("fallback text"));
    const relayed = relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: grokFail(502) as unknown as typeof fetch, onUpstreamFailure: h.fn });
    const result = await consumeMindTurn({ url: "/api/mind/turn", body: {}, headers: {}, signal: new AbortController().signal, fetchImpl: (async () => relayed) as unknown as typeof fetch, onDelta: () => undefined });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.provider, "openai");
    assert.equal(result.failedOverFrom, "grok");
    assert.equal(describeAnswer(result), "Failover: xAI failed, so OpenAI gpt-4.1-mini answered.");
  });
  it("both providers fail → one error naming both, no keys or raw URLs leak", async () => {
    const h = hook(ENV_WITH_OPENAI, openaiFail(500));
    const res = relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: grokFail(503) as unknown as typeof fetch, onUpstreamFailure: h.fn });
    const ev = await events(res);
    assert.equal(ev.length, 1);
    const err = (ev[0] as { error: string }).error;
    assert.equal(ev[0].event, "error");
    assert.match(err, /returned 503/);
    assert.match(err, /Failover to OpenAI also failed/);
    assert.doesNotMatch(err, /SECRET|sk-|xai-|https?:\/\//);
  });
  it("fallback fetch throws (network) → honest error, not a crash", async () => {
    const h = hook(ENV_WITH_OPENAI, async () => {
      throw new Error(`connect ECONNREFUSED https://api.openai.com ${OPENAI_KEY}`);
    });
    const res = relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: grokFail(500) as unknown as typeof fetch, onUpstreamFailure: h.fn });
    const err = ((await events(res))[0] as { error: string }).error;
    assert.match(err, /also failed/);
    assert.doesNotMatch(err, /FALLBACKSECRET|api\.openai\.com/);
  });
  it("no other provider configured → honest 'nothing substituted', no outbound call", async () => {
    let outbound = 0;
    const h = hook({}, async () => {
      outbound++;
      return { ok: true, status: 200, text: async () => "" };
    });
    const res = relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: grokFail(503) as unknown as typeof fetch, onUpstreamFailure: h.fn });
    const err = ((await events(res))[0] as { error: string }).error;
    assert.match(err, /no other provider is configured/);
    assert.equal(outbound, 0);
  });
  it("fallback returning 200 with junk JSON is NOT a success (no raw JSON as a reply)", async () => {
    const h = hook(ENV_WITH_OPENAI, async () => ({ ok: true, status: 200, text: async () => '{"weird":true}' }));
    const res = relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: grokFail(503) as unknown as typeof fetch, onUpstreamFailure: h.fn });
    const ev = await events(res);
    assert.equal(ev.some((e) => e.event === "done"), false);
    assert.match((ev[0] as { error: string }).error, /empty reply/);
  });
  it("network drop before any text → fails over; drop AFTER text streamed → no failover", async () => {
    const h1 = hook(ENV_WITH_OPENAI, openaiOk("ok"));
    const res1 = relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch, onUpstreamFailure: h1.fn });
    assert.equal((await events(res1)).find((e) => e.event === "done") ? h1.calls() : -1, 1);

    const h2 = hook(ENV_WITH_OPENAI, openaiOk("should not run"));
    const enc = new TextEncoder();
    let pulls = 0;
    const partial = new ReadableStream<Uint8Array>({
      pull(c) {
        // First read delivers real text; the next read drops the socket.
        if (pulls++ === 0) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "half" } }] })}\n\n`));
        else c.error(new TypeError("socket hang up"));
      },
    });
    const res2 = relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: (async () => new Response(partial, { status: 200 })) as unknown as typeof fetch, onUpstreamFailure: h2.fn });
    const ev2 = await events(res2);
    assert.equal(h2.calls(), 0, "must not splice a second provider after text streamed");
    assert.equal(ev2.some((e) => e.event === "done"), false);
  });
});

describe("aborted requests never fail over", () => {
  it("abort before the primary answers → stopped, fallback not called", async () => {
    const ctl = new AbortController();
    const h = hook(ENV_WITH_OPENAI, openaiOk("nope"));
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      ctl.abort();
      throw init.signal?.reason ?? new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    const ev = await events(relayModelStream({ ...base, requestSignal: ctl.signal, fetchImpl, onUpstreamFailure: h.fn }));
    assert.equal(h.calls(), 0);
    assert.equal(ev.some((e) => e.event === "done"), false);
    assert.equal((ev[0] as { error: string }).error, STOPPED_REPLY);
  });
  it("abort DURING the fallback → stopped, the fallback reply is not delivered", async () => {
    const ctl = new AbortController();
    const h = hook(ENV_WITH_OPENAI, async () => {
      ctl.abort();
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "late" } }] }) };
    });
    const ev = await events(relayModelStream({ ...base, requestSignal: ctl.signal, fetchImpl: grokFail(503) as unknown as typeof fetch, onUpstreamFailure: h.fn }));
    assert.equal(ev.some((e) => e.event === "done"), false);
    assert.equal(ev.some((e) => e.event === "delta"), false);
  });
  it("runFallback with an already-aborted signal makes no outbound call", async () => {
    const ctl = new AbortController();
    ctl.abort();
    let outbound = 0;
    const out = await runFallback({ primary: "grok", primaryError: "x", prompt: "hi", env: ENV_WITH_OPENAI, signal: ctl.signal, fetch: async () => { outbound++; return { ok: true, status: 200, text: async () => "" }; } });
    assert.equal(out.ok, false);
    assert.equal(outbound, 0);
  });
});

describe("toggle + request contract", () => {
  it("only literal true enables; stored only exact 'on'", () => {
    assert.equal(parseFailoverField(true), true);
    for (const v of ["true", 1, "on", { on: true }, [true], null]) assert.equal(parseFailoverField(v), false);
    assert.equal(readFailoverPolicy("on"), "on");
    for (const v of ["ON", "grok", "true", " on", null, undefined, 1]) assert.equal(readFailoverPolicy(v), "off");
  });
  it("pickFallbackProvider skips the primary, excluded and blank keys", () => {
    assert.equal(pickFallbackProvider("grok", { OPENAI_API_KEY: "   " }), null);
    assert.equal(pickFallbackProvider("openai", { OPENAI_API_KEY: "k1234" }), null);
    assert.equal(pickFallbackProvider("grok", { OPENAI_API_KEY: "k1", ANTHROPIC_API_KEY: "k2" }, ["openai"])?.id, "anthropic");
  });
  it("sanitizeProviderError scrubs keys, bearer tokens and endpoints (incl. gemini ?key=)", () => {
    const msg = sanitizeProviderError(
      "fail https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=AIzaSyABCDEFGHIJKLMNOP Bearer abc.def sk-proj-ZZZZZZZZ custom-secret-value",
      ["custom-secret-value"],
    );
    assert.doesNotMatch(msg, /AIza|googleapis|Bearer abc|sk-proj|custom-secret-value|https?:/);
    assert.equal(sanitizeProviderError(42), "The provider failed.");
    assert.ok(sanitizeProviderError("x".repeat(5000)).length <= 300);
  });
  it("extractProviderText reads each provider shape and never echoes raw JSON", () => {
    assert.equal(extractProviderText("openai", JSON.stringify({ choices: [{ message: { content: " a " } }] })), "a");
    assert.equal(extractProviderText("anthropic", JSON.stringify({ content: [{ type: "text", text: "b" }, { type: "tool_use" }] })), "b");
    assert.equal(extractProviderText("gemini", JSON.stringify({ candidates: [{ content: { parts: [{ text: "c" }, { text: "d" }] } }] })), "cd");
    assert.equal(extractProviderText("openrouter", "not json"), "");
    assert.equal(extractProviderText("openai", JSON.stringify({ choices: [{ message: { content: { evil: 1 } } }] })), "");
  });
  it("forged provider ids in a done event are dropped; UI never invents a provider", () => {
    const ev = pullMindEvents(`event: done\ndata: ${JSON.stringify({ text: "t", model: "m", provider: "<script>", failedOverFrom: "__proto__" })}\n\n`).events[0] as Record<string, unknown>;
    assert.equal(ev.provider, undefined);
    assert.equal(ev.failedOverFrom, undefined);
    assert.equal(describeAnswer(ev), "Answered by m.");
    assert.equal(describeAnswer({ model: "", provider: "grok", failedOverFrom: "grok" }), "Answered by xAI an unreported model.");
  });
});

describe("adversarial review additions", () => {
  it("image-only turn (no text) cannot fail over to a text-only provider", async () => {
    let outbound = 0;
    const out = await runFallback({ primary: "grok", primaryError: "Grok returned 503.", prompt: "   ", env: ENV_WITH_OPENAI, fetch: async () => { outbound++; return { ok: true, status: 200, text: async () => "" }; } });
    assert.equal(out.ok, false);
    assert.equal(outbound, 0);
  });
  it("a throwing hook still yields one honest error event, not a hung stream", async () => {
    const res = relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: grokFail(503) as unknown as typeof fetch, onUpstreamFailure: async () => { throw new Error(OPENAI_KEY); } });
    const ev = await events(res);
    assert.equal(ev.length, 1);
    assert.equal(ev[0].event, "error");
    assert.doesNotMatch((ev[0] as { error: string }).error, /FALLBACKSECRET/);
  });
  it("primary error leaking its own key + endpoint is scrubbed in the both-failed message", async () => {
    const out = await runFallback({ primary: "grok", primaryError: `401 from https://api.x.ai/v1 with ${XAI_KEY}`, prompt: "hi", env: ENV_WITH_OPENAI, fetch: openaiFail(429), secrets: [XAI_KEY] });
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.doesNotMatch(out.error, /PRIMARYSECRET|api\.x\.ai|https?:/);
    assert.match(out.error, /rate limited/);
  });
  it("200 empty-body primary (no text) fails over; failover off keeps the empty-reply error", async () => {
    const empty = (async () => new Response("data: [DONE]\n\n", { status: 200 })) as unknown as typeof fetch;
    const off = await events(relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: empty }));
    assert.equal(off[0].event, "error");
    const h = hook(ENV_WITH_OPENAI, openaiOk("rescued"));
    const on = await events(relayModelStream({ ...base, requestSignal: new AbortController().signal, fetchImpl: empty, onUpstreamFailure: h.fn }));
    assert.equal((on.find((e) => e.event === "done") as { provider?: string } | undefined)?.provider, "openai");
  });
});

describe("UI wiring (source contract)", () => {
  const src = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("./turn.server.ts", import.meta.url), "utf8");
  it("the toggle is visible and real (no static Off badge, no hidden card)", () => {
    assert.doesNotMatch(src, /settings-card rounded-panel p-4 text-sm hidden/);
    assert.match(src, /role="switch"\s+aria-label="Provider failover"/);
    assert.doesNotMatch(src, />Off<\/span>/);
  });
  it("send snapshots the toggle into the request body; no client-side provider swap", () => {
    assert.match(src, /const failoverForTurn = failoverPolicy === "on";/);
    assert.match(src, /failover: failoverForTurn,/);
    assert.doesNotMatch(src, /failover\(providerChoice/);
  });
  it("notice reports the server's answering provider; toggle disabled while busy; double send guarded", () => {
    assert.match(src, /describeAnswer\(result\)/);
    assert.match(src, /disabled=\{busy\}\s+aria-disabled=\{busy\}/);
    assert.match(src, /async function deliver\([^)]*\)[^{]*\{\s+if \(turnInFlight\.current\) return null;/);
  });
  it("server: failover opt-in parsed strictly and hook only attached once (no chains)", () => {
    assert.match(server, /parseFailoverField\(body\.failover\)/);
    assert.match(server, /failoverOn && !failedOverFrom && prepared\.images\.length === 0/);
  });
});
