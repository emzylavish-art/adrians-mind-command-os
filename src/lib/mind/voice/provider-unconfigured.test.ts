import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { failStage } from "./connection-stages.ts";
import { formatVoiceClientError } from "./errors.ts";
import { liveVoiceMissingNotice } from "./settings.ts";
import { providerUnconfiguredMessage, shouldForceVoiceUnconfigured } from "./provider-unconfigured.ts";

describe("provider not configured (deterministic)", () => {
  it("dev query enables force-unconfigured only in DEV", () => {
    assert.equal(shouldForceVoiceUnconfigured("?voiceForceUnconfigured=1", true), true);
    assert.equal(shouldForceVoiceUnconfigured("?voiceForceUnconfigured=true", true), true);
    assert.equal(shouldForceVoiceUnconfigured("?voiceForceUnconfigured=1", false), false);
    assert.equal(shouldForceVoiceUnconfigured("", true), false);
  });

  it("error stage copy names the missing provider and never says connected", () => {
    const failed = failStage("getting_session", providerUnconfiguredMessage());
    assert.equal(failed.stage, "error");
    assert.match(failed.error || "", /No speech key is configured/);
    assert.doesNotMatch(failed.error || "", /^connected$/i);
    assert.doesNotMatch(failed.status, /^connected$/i);
    const shown = formatVoiceClientError({ ok: false, error: providerUnconfiguredMessage() });
    assert.match(shown, /No speech key is configured/);
    assert.doesNotMatch(shown, /\bconnected\b/i);
    assert.doesNotMatch(liveVoiceMissingNotice(false), /\bconnected\b/i);
  });
});
