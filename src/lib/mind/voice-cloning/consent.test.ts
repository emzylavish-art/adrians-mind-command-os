import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildConsentPhrase,
  createConsentChallenge,
  generateConsentCode,
  hashConsentPhrase,
  isBlockedPublicFigureName,
  normalizeSpokenText,
  verifyConsentTranscript,
} from "./consent.ts";

describe("voice-cloning consent gate", () => {
  it("builds phrase with Adrian's Mind and code", () => {
    const phrase = buildConsentPhrase("A1B2C3D4");
    assert.match(phrase, /Adrian's Mind/);
    assert.match(phrase, /A1B2C3D4/);
    assert.doesNotMatch(phrase, /Edurain/i);
  });

  it("verifies matching transcript with code", () => {
    const code = "A1B2C3D4";
    const phrase = buildConsentPhrase(code);
    const ok = verifyConsentTranscript({
      transcript: "I consent to clone my voice for Adrian's Mind. Confirmation code A1B2C3D4.",
      expectedCode: code,
      expectedPhrase: phrase,
    });
    assert.equal(ok.ok, true);
  });

  it("rejects missing code (replay / wrong phrase)", () => {
    const phrase = buildConsentPhrase("A1B2C3D4");
    const bad = verifyConsentTranscript({
      transcript: "I consent to clone my voice for Adrian's Mind.",
      expectedCode: "A1B2C3D4",
      expectedPhrase: phrase,
    });
    assert.equal(bad.ok, false);
  });

  it("rejects wrong code", () => {
    const phrase = buildConsentPhrase("A1B2C3D4");
    const bad = verifyConsentTranscript({
      transcript: "I consent to clone my voice for Adrian's Mind. Confirmation code ZZZZZZZZ.",
      expectedCode: "A1B2C3D4",
      expectedPhrase: phrase,
    });
    assert.equal(bad.ok, false);
  });

  it("blocks public figure names", () => {
    assert.equal(isBlockedPublicFigureName("Elon Musk"), true);
    assert.equal(isBlockedPublicFigureName("voice of Taylor Swift"), true);
    assert.equal(isBlockedPublicFigureName("Zack Home Studio"), false);
  });

  it("hashes phrase stably after normalize", () => {
    const a = hashConsentPhrase("Hello, CODE!");
    const b = hashConsentPhrase("hello code");
    assert.equal(a, b);
    assert.equal(normalizeSpokenText("A1B2"), "a1b2");
  });

  it("creates challenge with expiry and unique ids", () => {
    const c1 = createConsentChallenge(1_000_000);
    const c2 = createConsentChallenge(1_000_000, () => "DEADBEEF");
    assert.notEqual(c1.challengeId, c2.challengeId);
    assert.equal(c2.code, "DEADBEEF");
    assert.ok(Date.parse(c1.expiresAt) > 1_000_000);
  });

  it("generateConsentCode is hex-ish uppercase", () => {
    const code = generateConsentCode(() => Buffer.from([0xab, 0xcd, 0xef, 0x01]));
    assert.equal(code, "ABCDEF01");
  });
});
