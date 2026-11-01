import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_AUDIO_BASE64_CHARS,
  SPEAK_TEXT_HARD_MAX,
  decodeAudioBase64,
  sanitizeAudioFilename,
  validateSpeakTextInput,
  validateTranscribeAudioInput,
} from "./voice-input.ts";

describe("voice-input H11", () => {
  it("speakText rejects non-string without throwing", () => {
    for (const bad of [null, undefined, 123, {}, [], true]) {
      const r = validateSpeakTextInput(bad);
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error, /string|Nothing to read/i);
    }
  });

  it("speakText caps length before trim and rejects oversized input", () => {
    const huge = "x".repeat(SPEAK_TEXT_HARD_MAX + 1);
    const r = validateSpeakTextInput(huge);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /too long/i);
    const ok = validateSpeakTextInput("  hello world  ");
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.text, "hello world");
  });

  it("transcribe rejects non-string audioBase64 before decode", () => {
    const r = validateTranscribeAudioInput({ audioBase64: 12345 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /not a string/i);
  });

  it("transcribe rejects oversized base64 BEFORE decode", () => {
    const oversized = "A".repeat(MAX_AUDIO_BASE64_CHARS + 1);
    const r = validateTranscribeAudioInput({ audioBase64: oversized });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /too large/i);
    // decode must never be attempted — validate alone rejects
    assert.equal(decodeAudioBase64(oversized).ok, false);
  });

  it("transcribe allowlists mime and sanitises filename", () => {
    const badMime = validateTranscribeAudioInput({
      audioBase64: Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
      mime: "text/html",
      filename: "../../etc/passwd<script>.wav",
    });
    assert.equal(badMime.ok, false);
    if (!badMime.ok) assert.match(badMime.error, /not supported/i);

    const ok = validateTranscribeAudioInput({
      audioBase64: Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
      mime: "audio/webm;codecs=opus",
      filename: "../../evil name!!.webm",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.mime, "audio/webm");
      assert.equal(ok.filename.includes(".."), false);
      assert.equal(ok.filename.includes("/"), false);
      assert.match(ok.filename, /\.webm$/);
    }
  });

  it("sanitizeAudioFilename strips paths and caps length", () => {
    const name = sanitizeAudioFilename("a/b/c/" + "z".repeat(120) + ".wav", "audio/wav");
    assert.ok(name.length <= 64);
    assert.equal(name.includes("/"), false);
  });

  it("decodeAudioBase64 rejects empty/tiny payloads honestly", () => {
    const r = decodeAudioBase64(Buffer.from("hi").toString("base64"));
    assert.equal(r.ok, false);
  });
});
