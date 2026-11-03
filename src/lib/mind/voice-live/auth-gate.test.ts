import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertVoiceSignedInForMic,
  resetVoiceAuthCache,
  setVoiceAuthCache,
} from "./auth-gate.ts";
import { VOICE_SIGN_IN_REQUIRED } from "../voice/errors.ts";

describe("voice auth-gate (sign-in before mic)", () => {
  it("fails closed when auth is on and the cache says signed out", () => {
    resetVoiceAuthCache();
    setVoiceAuthCache({ authEnabled: true, signedIn: false, pending: false });
    const gate = assertVoiceSignedInForMic();
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.error, VOICE_SIGN_IN_REQUIRED);
  });

  it("allows mic when auth is disabled (dev fallback)", () => {
    resetVoiceAuthCache();
    setVoiceAuthCache({ authEnabled: false, signedIn: false, pending: false });
    assert.deepEqual(assertVoiceSignedInForMic(), { ok: true });
  });

  it("allows when signed in", () => {
    resetVoiceAuthCache();
    setVoiceAuthCache({ authEnabled: true, signedIn: true, pending: false });
    assert.deepEqual(assertVoiceSignedInForMic(), { ok: true });
  });

  it("does not block while session is still pending", () => {
    resetVoiceAuthCache();
    setVoiceAuthCache({ authEnabled: true, signedIn: false, pending: true });
    assert.deepEqual(assertVoiceSignedInForMic(), { ok: true });
  });
});
