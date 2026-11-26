import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HANDY_SOURCE, HANDY_WAVE_BARS, HANDY_WHISPER_URL, detectWithHandy, handyBarHeight, handyLiveLevels } from "./handy-dictation.ts";
import { refreshSkills } from "./skill-refresh.ts";
import { OPUS_MT_URL, REJECTED_GOOGLE_TRANSLATOR, SOKUJI_SOURCE, translateVoice, voiceHostAllowed } from "./voice-translator.ts";

test("Handy dictation uses the project wave and does not ask to refresh skills", () => {
  assert.equal(HANDY_SOURCE, "https://github.com/cjpais/handy");
  assert.equal(HANDY_WHISPER_URL, "http://127.0.0.1:4196/handy-stt");
  assert.equal(HANDY_WAVE_BARS, 9);
  assert.equal(handyLiveLevels(1).length, 9);
  assert.equal(handyBarHeight(0), 3);
  assert.ok(handyBarHeight(1) > handyBarHeight(0));
  const refreshed = refreshSkills(undefined, Date.parse("2026-11-21T00:00:00Z"));
  assert.equal(refreshed.askedPermission, false);
  assert.ok(refreshed.count > 0);
  assert.equal(refreshed.refreshedAt, "2026-11-21T00:00:00.000Z");
  assert.equal(voiceHostAllowed("https://translate.google.com/translate"), false);
  assert.equal(voiceHostAllowed(REJECTED_GOOGLE_TRANSLATOR), true);
});

test("Opus-MT reports loaded weights for a sentence that is not a test phrase", async () => {
  const translated = await translateVoice("The harbor opens at dawn", "es", (async () => new Response(JSON.stringify({
    ok: true,
    weightsLoaded: true,
    text: "El puerto se abre al amanecer",
    pair: "Xenova/opus-mt-en-es",
    note: "Translated by Xenova/opus-mt-en-es. Nothing was sent to Google.",
  }), { status: 200 })) as typeof fetch);
  assert.equal(translated.engine, "sokuji");
  assert.equal(translated.model, "opus-mt");
  assert.equal(translated.source, SOKUJI_SOURCE);
  assert.equal(translated.google, false);
  assert.equal(translated.weightsLoaded, true);
  assert.equal(translated.text, "El puerto se abre al amanecer");
  assert.equal(translated.pair, "Xenova/opus-mt-en-es");
  assert.equal(translated.note.includes("not loaded"), false);
  const down = await translateVoice("The harbor opens at dawn", "fr", (async () => {
    throw new Error("down");
  }) as typeof fetch);
  assert.equal(down.weightsLoaded, false);
  assert.equal(down.text, null);
  assert.equal(OPUS_MT_URL, "http://127.0.0.1:4197/opus-mt");
});

test("Speak detection asks the loaded Handy engine and does not invent words", { skip: process.env.MIND_TEST_HANDY_LIVE !== "1" ? "Requires explicit MIND_TEST_HANDY_LIVE=1 and a local audio fixture; no live service called by normal tests" : false }, async () => {
  const audio = readFileSync("/tmp/handy-engine/harbor.wav").toString("base64");
  const heard = await detectWithHandy(audio);
  assert.equal(heard.ok, true);
  if (heard.ok) {
    assert.equal(heard.provider, "handy");
    assert.match(heard.text, /harbor/i);
    assert.notEqual(heard.text, "hello from handy");
  }
  const missed = await detectWithHandy("", fetch);
  assert.equal(missed.ok, false);
});
