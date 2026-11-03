import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapSttClientError, STT_SIGN_IN_REQUIRED } from "./stt-client-errors.ts";

describe("whisper-flow stt client errors", () => {
  it("maps 401 / Unauthorized to the sign-in message", () => {
    assert.equal(mapSttClientError({ status: 401 }), STT_SIGN_IN_REQUIRED);
    assert.equal(mapSttClientError(new Error("Unauthorized")), STT_SIGN_IN_REQUIRED);
    assert.equal(mapSttClientError("Sign in is required."), STT_SIGN_IN_REQUIRED);
  });

  it("passes through other errors honestly", () => {
    assert.match(mapSttClientError("Speech-to-text returned 503."), /503/);
  });
});
