/**
 * Failover context parity: the fallback provider receives the same assembled context
 * (system/persona prompt, history, memory notes) the primary got — built once by
 * assembleTurn and reused — never just the latest user message.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runFallback } from "./failover.ts";
import { assembleTurn } from "./prompt.ts";
import { buildProviderRequestBody, callConfiguredProvider, FALLBACK_CONTEXT_MAX_CHARS, toTextOnlyMessages } from "./provider-call.ts";
import { relayModelStream } from "./relay.ts";
import { pullMindEvents } from "./stream.ts";

const XAI_KEY = "xai-PRIMARYSECRET123456";
const OPENAI_KEY = "sk-FALLBACKSECRET987654";
const ANTHROPIC_KEY = "sk-ant-ANTHROPICSECRET55555";
const GEMINI_KEY = "AIzaGEMINISECRET0123456789";
const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function assembled(overrides: Partial<Parameters<typeof assembleTurn>[0]> = {}) {
  const out = assembleTurn({
    memory: "on",
    history: [
      { role: "user", content: "My dog is called Biscuit." },
      { role: "assistant", content: "Noted — Biscuit." },
    ],
    text: "What is my dog called?",
    memoryContext: [{ id: "note-1", text: "Prefers short answers." }],
    ...overrides,
  });
  assert.equal(out.ok, true);
  if (!out.ok) throw new Error("assemble failed");
  return out.messages;
}

type Captured = { url: string; body: Record<string, unknown>; raw: string };
function capture(reply: (id: string) => string) {
  const calls: Captured[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const raw = String(init?.body ?? "");
    calls.push({ url, body: JSON.parse(raw), raw });
    const id = /openai/.test(url) ? "openai" : /anthropic/.test(url) ? "anthropic" : /googleapis/.test(url) ? "gemini" : "openrouter";
    return { ok: true, status: 200, text: async () => reply(id) };
  };
  return { calls, fetchImpl };
}
const openaiReply = (text: string) => () => JSON.stringify({ choices: [{ message: { content: text } }] });

describe("fallback receives the primary's assembled context", () => {
  it("openai fallback body carries system prompt + memory note + history + current turn, in order", async () => {
    const messages = assembled();
    const cap = capture(openaiReply("Biscuit."));
    const out = await runFallback({ primary: "grok", primaryError: "Grok returned 503.", messages, env: { OPENAI_API_KEY: OPENAI_KEY }, fetch: cap.fetchImpl, secrets: [XAI_KEY] });
    assert.equal(out.ok, true);
    assert.equal(cap.calls.length, 1);
    const sent = cap.calls[0]!.body.messages as { role: string; content: string }[];
    assert.deepEqual(sent.map((m) => m.role), ["system", "user", "assistant", "user"]);
    assert.match(sent[0]!.content, /Adrian's Mind/);
    assert.match(sent[0]!.content, /\[note-1\] Prefers short answers\./);
    assert.equal(sent[1]!.content, "My dog is called Biscuit.");
    assert.equal(sent[2]!.content, "Noted — Biscuit.");
    assert.equal(sent[3]!.content, "What is my dog called?");
  });

  it("fallback messages equal the primary's messages (shared builder, no re-derivation)", async () => {
    const messages = assembled();
    const cap = capture(openaiReply("ok"));
    await runFallback({ primary: "grok", primaryError: "x", messages, env: { OPENAI_API_KEY: OPENAI_KEY }, fetch: cap.fetchImpl });
    assert.deepEqual(cap.calls[0]!.body.messages, messages);
  });

  it("anthropic fallback: system goes in top-level `system`, history alternates and starts with user", async () => {
    const messages = assembled({ history: [{ role: "assistant", content: "Hi there." }, { role: "user", content: "a" }, { role: "user", content: "b" }] });
    const cap = capture(() => JSON.stringify({ content: [{ type: "text", text: "ok" }] }));
    const out = await runFallback({ primary: "grok", primaryError: "x", messages, env: { ANTHROPIC_API_KEY: ANTHROPIC_KEY }, fetch: cap.fetchImpl });
    assert.equal(out.ok, true);
    const body = cap.calls[0]!.body as { system: string; messages: { role: string; content: string }[] };
    assert.match(body.system, /Adrian's Mind/);
    assert.match(body.system, /note-1/);
    assert.equal(body.messages.some((m) => (m.role as string) === "system"), false);
    assert.equal(body.messages[0]!.role, "user");
    for (let i = 1; i < body.messages.length; i++) assert.notEqual(body.messages[i]!.role, body.messages[i - 1]!.role, "roles must alternate");
    assert.equal(body.messages.at(-1)!.role, "user");
    assert.match(body.messages.at(-1)!.content, /What is my dog called\?/);
    assert.match(JSON.stringify(body.messages), /Hi there\./, "leading assistant history is kept, not dropped");
  });

  it("gemini fallback: systemInstruction + user/model contents", async () => {
    const messages = assembled();
    const cap = capture(() => JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }));
    const out = await runFallback({ primary: "grok", primaryError: "x", messages, env: { GEMINI_API_KEY: GEMINI_KEY }, fetch: cap.fetchImpl });
    assert.equal(out.ok, true);
    const body = cap.calls[0]!.body as { systemInstruction: { parts: { text: string }[] }; contents: { role: string; parts: { text: string }[] }[] };
    assert.match(body.systemInstruction.parts[0]!.text, /note-1/);
    assert.deepEqual(body.contents.map((c) => c.role), ["user", "model", "user"]);
    assert.equal(body.contents.at(-1)!.parts[0]!.text, "What is my dog called?");
  });

  it("memory OFF: fallback gets the same 'Memory is OFF' system line and no notes", async () => {
    const messages = assembled({ memory: "off", memoryContext: [] });
    const cap = capture(openaiReply("ok"));
    await runFallback({ primary: "grok", primaryError: "x", messages, env: { OPENAI_API_KEY: OPENAI_KEY }, fetch: cap.fetchImpl });
    assert.match(cap.calls[0]!.raw, /Memory is OFF/);
    assert.doesNotMatch(cap.calls[0]!.raw, /note-1/);
  });
});

describe("attacker cases", () => {
  it("history with image parts: no data-URL/base64 reaches the text-only fallback; a stub says an image was there", async () => {
    const messages = assembled({ history: [{ role: "user", content: "look at this", images: [{ dataUrl: IMG }] }, { role: "assistant", content: "A cat." }] });
    assert.ok(Array.isArray(messages[1]!.content), "precondition: primary history carries image parts");
    for (const env of [{ OPENAI_API_KEY: OPENAI_KEY }, { ANTHROPIC_API_KEY: ANTHROPIC_KEY }, { GEMINI_API_KEY: GEMINI_KEY }]) {
      const cap = capture((id) => (id === "anthropic" ? JSON.stringify({ content: [{ type: "text", text: "ok" }] }) : id === "gemini" ? JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) : openaiReply("ok")()));
      const out = await runFallback({ primary: "grok", primaryError: "x", messages, env, fetch: cap.fetchImpl });
      assert.equal(out.ok, true);
      assert.doesNotMatch(cap.calls[0]!.raw, /data:image|base64|iVBORw0KGgo|image_url/);
      assert.match(cap.calls[0]!.raw, /look at this/);
      assert.match(cap.calls[0]!.raw, /cannot see/);
    }
  });

  it("current turn carrying image parts never fails over, even if a caller passes it in (no outbound call)", async () => {
    const messages = assembled({ images: [{ dataUrl: IMG }], text: "what is this" });
    let outbound = 0;
    const out = await runFallback({ primary: "grok", primaryError: "x", messages, env: { OPENAI_API_KEY: OPENAI_KEY }, fetch: async () => { outbound++; return { ok: true, status: 200, text: async () => openaiReply("x")() }; } });
    assert.equal(out.ok, false);
    assert.equal(outbound, 0);
  });

  it("no secret (primary key, any provider key) is placed in the fallback request body", async () => {
    const messages = assembled();
    const cap = capture(openaiReply("ok"));
    const env = { OPENAI_API_KEY: OPENAI_KEY, ANTHROPIC_API_KEY: ANTHROPIC_KEY, GEMINI_API_KEY: GEMINI_KEY, XAI_API_KEY: XAI_KEY };
    await runFallback({ primary: "grok", primaryError: `boom ${XAI_KEY} https://api.x.ai/v1`, messages, env, fetch: cap.fetchImpl, secrets: [XAI_KEY] });
    for (const secret of [XAI_KEY, OPENAI_KEY, ANTHROPIC_KEY, GEMINI_KEY]) assert.equal(cap.calls[0]!.raw.includes(secret), false);
    assert.doesNotMatch(cap.calls[0]!.raw, /api\.x\.ai|boom/, "primary error text is not forwarded to the fallback model");
  });

  it("max-size history (12 × 8000 chars) is sent intact — same truncation as the primary, no 4000-char cut", async () => {
    const big = "x".repeat(7990);
    const history = Array.from({ length: 12 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `${i}:${big}` }));
    const messages = assembled({ history, text: "final question" });
    const cap = capture(openaiReply("ok"));
    await runFallback({ primary: "grok", primaryError: "x", messages, env: { OPENAI_API_KEY: OPENAI_KEY }, fetch: cap.fetchImpl });
    const sent = cap.calls[0]!.body.messages as { content: string }[];
    assert.equal(sent.length, messages.length);
    assert.deepEqual(sent, messages);
  });

  it("over-budget context drops OLDEST history first; system prompt and current turn always survive", () => {
    const huge = "y".repeat(Math.floor(FALLBACK_CONTEXT_MAX_CHARS / 3));
    const msgs = [
      { role: "system" as const, content: "SYS" },
      { role: "user" as const, content: "old1 " + huge },
      { role: "assistant" as const, content: "old2 " + huge },
      { role: "user" as const, content: "new1 " + huge },
      { role: "user" as const, content: "CURRENT" },
    ];
    const out = toTextOnlyMessages(msgs);
    const total = out.reduce((n, m) => n + m.content.length, 0);
    assert.ok(total <= FALLBACK_CONTEXT_MAX_CHARS);
    assert.equal(out[0]!.content, "SYS");
    assert.equal(out.at(-1)!.content, "CURRENT");
    assert.equal(out.some((m) => m.content.startsWith("old1")), false);
  });

  it("long fallback reply (> 4000 chars) is not cut mid-JSON into an 'empty reply' failure", async () => {
    const long = "z".repeat(12000);
    const cap = capture(openaiReply(long));
    const out = await runFallback({ primary: "grok", primaryError: "x", messages: assembled(), env: { OPENAI_API_KEY: OPENAI_KEY }, fetch: cap.fetchImpl });
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.text.length, 12000);
  });

  it("malformed messages (non-array content, unknown roles, empty) do not crash or leak; empty → honest refusal", async () => {
    let outbound = 0;
    const junk = [{ role: "tool", content: "rm -rf" }, { role: "user", content: { evil: true } }, { role: "user", content: "   " }] as unknown as Parameters<typeof runFallback>[0]["messages"];
    const out = await runFallback({ primary: "grok", primaryError: "x", messages: junk, env: { OPENAI_API_KEY: OPENAI_KEY }, fetch: async () => { outbound++; return { ok: true, status: 200, text: async () => "" }; } });
    assert.equal(out.ok, false);
    assert.equal(outbound, 0);
  });

  it("legacy prompt-only callers still work (single user message)", async () => {
    const body = buildProviderRequestBody("openai", [{ role: "user", content: "hi" }]) as { messages: unknown[] };
    assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
    const r = await callConfiguredProvider({ id: "openai", key: OPENAI_KEY, prompt: "hi", fetch: async (_u, init) => ({ ok: true, status: 200, text: async () => { assert.match(String(init?.body), /"hi"/); return openaiReply("ok")(); } }) });
    assert.equal(r.ok, true);
  });
});

describe("end to end through the relay: Grok fails, fallback sees full context", () => {
  it("relay hook → fallback body has system+history+memory; done names the fallback; tier not resolved", async () => {
    const messages = assembled();
    const cap = capture(openaiReply("Biscuit."));
    const res = relayModelStream({
      apiKey: XAI_KEY,
      model: "primary-model",
      messages,
      usedIds: ["note-1"],
      requestSignal: new AbortController().signal,
      fetchImpl: (async () => new Response("boom", { status: 503 })) as unknown as typeof fetch,
      meta: { modelTier: "Expert", resolvedTier: "Expert" },
      onUpstreamFailure: (error, signal) => runFallback({ primary: "grok", primaryError: error, messages, env: { OPENAI_API_KEY: OPENAI_KEY }, fetch: cap.fetchImpl, signal, secrets: [XAI_KEY] }),
    });
    const ev = pullMindEvents(await res.text()).events;
    const done = ev.find((e) => e.event === "done") as Record<string, unknown>;
    assert.equal(done.provider, "openai");
    assert.equal(done.resolvedTier, undefined);
    assert.deepEqual(done.usedIds, ["note-1"]);
    assert.match(cap.calls[0]!.raw, /note-1/);
    assert.match(cap.calls[0]!.raw, /Biscuit/);
  });

  it("server wires the primary's assembled messages into the fallback (source contract)", () => {
    const server = readFileSync(new URL("./turn.server.ts", import.meta.url), "utf8");
    assert.match(server, /runFallback\(\{[\s\S]*?messages: prepared\.assembled\.messages,/);
    assert.match(server, /prepared\.images\.length === 0/);
  });
});
