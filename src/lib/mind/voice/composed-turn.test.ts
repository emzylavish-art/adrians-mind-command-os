import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runComposedVoiceTurn } from "./composed-turn.ts";
import { DEFAULT_VOICE_ROUTE, normalizeVoiceRoute, parseCloudSpeechPolicy, readVoiceRoutePreferences, writeVoiceRoutePreferences } from "./route-preferences.ts";

describe("C5 composed Speak execution", () => {
  it("sends one transcript to the selected text provider and its answer to a separate speech engine", async () => {
    const calls: string[] = [];
    const result = await runComposedVoiceTurn({ route: { ...DEFAULT_VOICE_ROUTE, ttsProvider: "openai" }, signal: new AbortController().signal }, {
      capture: async () => { calls.push("stt"); return { text: "question", provider: "xAI" }; },
      answer: async (text) => { calls.push(`Gemini:${text}`); return { reply: "answer", provider: "Gemini", model: "fixture-model" }; },
      speak: async (text, provider) => { calls.push(`${provider}:${text}`); return { provider: "OpenAI" }; },
    });
    assert.deepEqual(calls, ["stt", "Gemini:question", "openai:answer"]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.receipts.map((r) => r.provider), ["xAI", "Gemini", "OpenAI"]);
  });
  it("never substitutes a different answer provider on authentication, rate limit, or timeout", async () => {
    for (const error of ["authentication rejected", "rate limited", "timeout"]) {
      let answers = 0, spoken = 0;
      const result = await runComposedVoiceTurn({ route: { ...DEFAULT_VOICE_ROUTE }, signal: new AbortController().signal, text: "hello" }, {
        capture: async () => { throw new Error("typed input needs no recording"); },
        answer: async () => { answers++; return { error }; }, speak: async () => { spoken++; return { provider: "xAI" }; },
      });
      assert.equal(result.error, error); assert.equal(answers, 1); assert.equal(spoken, 0);
    }
  });
  it("ending a call during delayed recognition prevents answer dispatch", async () => {
    const controller = new AbortController();
    let answerCalls = 0;
    const result = await runComposedVoiceTurn({ route: { ...DEFAULT_VOICE_ROUTE }, signal: controller.signal }, {
      capture: async () => { controller.abort(); return { text: "late", provider: "xAI" }; },
      answer: async () => { answerCalls++; return { reply: "unexpected" }; },
      speak: async () => ({ provider: "xAI" }),
    });
    assert.equal(result.canceled, true); assert.equal(answerCalls, 0);
  });
  it("mute during delayed answer suppresses speech without resending the answer", async () => {
    let muted = false, speech = 0;
    const result = await runComposedVoiceTurn({ route: { ...DEFAULT_VOICE_ROUTE }, signal: new AbortController().signal, text: "question" }, {
      capture: async () => ({ text: "", provider: "browser" }),
      answer: async () => { muted = true; return { reply: "answer", provider: "Claude" }; },
      canSpeak: () => !muted,
      speak: async () => { speech++; return { provider: "xAI" }; },
    });
    assert.equal(result.ok, true); assert.equal(result.reply, "answer"); assert.equal(speech, 0);
  });
  it("free-only rejects a billable speech stage before capture or model dispatch", async () => {
    const result = await runComposedVoiceTurn({ route: { ...DEFAULT_VOICE_ROUTE }, signal: new AbortController().signal, freeOnly: true }, {
      capture: async () => { assert.fail("no cloud capture"); }, answer: async () => { assert.fail("no surprise model request"); }, speak: async () => { assert.fail("no speech dispatch"); },
    });
    assert.equal(result.ok, false); assert.match(result.error || "", /Free-only/);
  });
  it("persists explicit stages separately by owner and discards invalid fallback", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) || null, setItem: (k: string, v: string) => { values.set(k, v); } };
    writeVoiceRoutePreferences(storage, "A", { ...DEFAULT_VOICE_ROUTE, sttProvider: "openai", ttsProvider: "browser", sttFallbackProvider: "xai" });
    assert.equal(readVoiceRoutePreferences(storage, "A").sttProvider, "openai");
    assert.deepEqual(readVoiceRoutePreferences(storage, "B"), DEFAULT_VOICE_ROUTE);
    assert.equal(normalizeVoiceRoute({ sttProvider: "xai", sttFallbackProvider: "xai" }).sttFallbackProvider, null);
    assert.deepEqual(parseCloudSpeechPolicy({}), { ok: true, value: { provider: "xai", fallbackProvider: null } });
    assert.equal(parseCloudSpeechPolicy({ provider: "invented" }).ok, false);
  });
});
