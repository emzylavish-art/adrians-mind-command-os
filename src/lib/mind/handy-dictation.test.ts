import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
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

test("Speak detection preserves the Handy receipt and reports unavailable or missing audio", async () => {
  const requests: RequestInit[] = [];
  const heard = await detectWithHandy(Buffer.from("synthetic fixture audio").toString("base64"), (async (url, init) => {
    assert.equal(url, HANDY_WHISPER_URL);
    requests.push(init!);
    return Response.json({ ok: true, text: "Fixture transcript" });
  }) as typeof fetch);
  assert.deepEqual(heard, { ok: true, text: "Fixture transcript", provider: "handy" });
  assert.equal(requests.length, 1);
  const missing = await detectWithHandy("", async () => { throw new Error("Empty audio must not dispatch"); });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /No audio was recorded/);
  const down = await detectWithHandy("Zml4dHVyZQ==", async () => { throw new Error("Synthetic unavailable engine"); });
  assert.equal(down.ok, false);
  if (!down.ok) assert.match(down.error, /not running/);
});

test("Opus-MT adapter preserves a fixture receipt and reports an unavailable engine", async () => {
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

test("Speak detection passes synthetic audio to Handy and preserves its fixture transcript", async () => {
  // A deterministic transport fixture, not evidence of a loaded engine or microphone.
  const audioBytes = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69]);
  const audio = Buffer.from(audioBytes).toString("base64");
  let calls = 0;
  const fakeFetch = (async (url, init) => {
    calls++;
    assert.equal(url, HANDY_WHISPER_URL);
    assert.equal(init?.method, "POST");
    assert.deepEqual(new Uint8Array(init?.body as ArrayBuffer), audioBytes);
    return new Response(JSON.stringify({ ok: true, text: "The harbor opens at dawn" }));
  }) as typeof fetch;
  const heard = await detectWithHandy(audio, fakeFetch);
  assert.equal(heard.ok, true);
  if (heard.ok) {
    assert.equal(heard.provider, "handy");
    assert.match(heard.text, /harbor/i);
    assert.notEqual(heard.text, "hello from handy");
  }
  const missed = await detectWithHandy("", fakeFetch);
  assert.equal(missed.ok, false);
  assert.equal(calls, 1, "empty audio must not contact even the local engine");
  const failed = await detectWithHandy(audio, (async () => { throw new Error("fixture engine unavailable"); }) as typeof fetch);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.match(failed.error, /Nothing was transcribed/);
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
