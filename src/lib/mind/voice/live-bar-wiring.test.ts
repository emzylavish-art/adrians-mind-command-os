
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../.."); // → src/
const COMMAND_APP = join(ROOT, "components/mind/command-app.tsx");

describe("live bar wiring (no toast-only markPreview)", () => {
  it("mounts LiveVoiceBar with realtime handlers, not markPreview stubs", () => {
    const src = readFileSync(COMMAND_APP, "utf8");
    assert.match(src, /<LiveVoiceBar\b/);
    assert.match(src, /onUserTranscript=/);
    assert.match(src, /onAssistantTranscript=/);
    assert.match(src, /useLiveVoiceSession|createHoldToTalkController/);
    // Toast-only preview stubs from older shells must not gate Speak/mute/end.
    assert.equal(/markPreview\(\s*[\"']Speak[\"']/.test(src), false);
    assert.equal(/markPreview\(\s*[\"']Live speak/.test(src), false);
    assert.equal(/markPreview\(\s*[\"']Live bar mute[\"']/.test(src), false);
    assert.equal(/markPreview\(\s*[\"']Voice mode end[\"']/.test(src), false);
  });
});
