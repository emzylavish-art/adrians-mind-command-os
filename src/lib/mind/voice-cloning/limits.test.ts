import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAllowedVcsAudioMime,
  VCS_MAX_GENERATE_CHARS,
  VCS_MAX_PROFILES_PER_USER,
} from "./limits.ts";
import { validateAudioBase64, validateGenerateText, validateProfileName } from "./validate.ts";
import { buildAudioExportFilename, prepareExportAudio, sanitizeFilenamePart } from "./export.ts";

describe("voice-cloning limits", () => {
  it("rejects oversized generate text before trim abuse", () => {
    const huge = "x".repeat(9000);
    const r = validateGenerateText(huge);
    assert.equal(r.ok, false);
  });

  it("clamps generate text to max", () => {
    const r = validateGenerateText("  hello  ");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.text, "hello");
    assert.ok(VCS_MAX_GENERATE_CHARS >= 500);
  });

  it("rejects bad MIME and tiny audio", () => {
    assert.equal(isAllowedVcsAudioMime("application/pdf"), false);
    assert.equal(isAllowedVcsAudioMime("audio/wav"), true);
    const tiny = validateAudioBase64({
      audioBase64: Buffer.from("hi").toString("base64"),
      mime: "audio/wav",
      label: "Sample",
    });
    assert.equal(tiny.ok, false);
  });

  it("rejects blocked / empty names", () => {
    assert.equal(validateProfileName("").ok, false);
    assert.equal(validateProfileName("Donald Trump").ok, false);
    assert.equal(validateProfileName("My Studio Voice").ok, true);
  });

  it("export filename includes profile and timestamp", () => {
    const name = buildAudioExportFilename("My Voice!", "mp3", new Date("2026-11-03T01:02:03Z"));
    assert.equal(name, "My_Voice_20261103T010203Z.mp3");
    assert.equal(sanitizeFilenamePart("../etc/passwd"), "etc_passwd");
  });

  it("WAV export refuses mp3 bytes; MP3 passes", () => {
    const mp3 = prepareExportAudio({ audioBase64: "aaaa", sourceMime: "audio/mpeg", format: "mp3" });
    assert.equal(mp3.ok, true);
    const wav = prepareExportAudio({ audioBase64: "aaaa", sourceMime: "audio/mpeg", format: "wav" });
    assert.equal(wav.ok, false);
    assert.ok(VCS_MAX_PROFILES_PER_USER >= 1);
  });
});
