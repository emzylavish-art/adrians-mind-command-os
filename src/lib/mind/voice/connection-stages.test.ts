import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  enterStage,
  failStage,
  normalizeVoiceConnectError,
  stageTimeoutMessage,
  VOICE_STAGE_TIMEOUT_MS,
} from "./connection-stages.ts";

describe("voice connection stages", () => {
  it("builds labeled stages and timeout errors", () => {
    assert.equal(enterStage("getting_session").status, "Getting session…");
    assert.equal(VOICE_STAGE_TIMEOUT_MS, 10_000);
    assert.match(stageTimeoutMessage("connecting"), /Connecting.*timed out/i);
    const failed = failStage("getting_session", "Unauthorized");
    assert.equal(failed.stage, "error");
    assert.match(failed.error ?? "", /Getting session/);
  });

  it("maps Unauthorized to a clear sign-in / local preview message", () => {
    assert.match(normalizeVoiceConnectError(new Error("Unauthorized")), /Sign in is required/);
  });
});
