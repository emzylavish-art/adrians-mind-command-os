import assert from "node:assert/strict";
import test from "node:test";
import { HANDY_SOURCE, HANDY_WAVE_BARS, HANDY_WHISPER_URL, detectWithHandy, handyBarHeight, handyLiveLevels } from "./handy-dictation.ts";
import { refreshSkills } from "./skill-refresh.ts";
import { REJECTED_GOOGLE_TRANSLATOR, SOKUJI_SOURCE, translateVoice, voiceHostAllowed } from "./voice-translator.ts";

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
  const translated = translateVoice("hello", "es");
  assert.equal(translated.engine, "sokuji");
  assert.equal(translated.model, "opus-mt");
  assert.equal(translated.source, SOKUJI_SOURCE);
  assert.equal(translated.google, false);
  assert.equal(translated.weightsLoaded, false);
  assert.equal(translated.text, "hola");
  assert.equal(voiceHostAllowed("https://translate.google.com/translate"), false);
  assert.equal(voiceHostAllowed(REJECTED_GOOGLE_TRANSLATOR), true);
});

test("Speak detection asks Handy Whisper Flow and does not invent words", async () => {
  const calls: string[] = [];
  const heard = await detectWithHandy(btoa("audio"), (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ ok: true, text: "hello from handy" }), { status: 200 });
  }) as typeof fetch);
  assert.deepEqual(calls, [HANDY_WHISPER_URL]);
  assert.equal(heard.ok && heard.provider, "handy");
  assert.equal(heard.ok && heard.text, "hello from handy");
  const missed = await detectWithHandy("", fetch);
  assert.equal(missed.ok, false);
});
