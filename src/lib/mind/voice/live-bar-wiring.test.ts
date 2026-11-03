import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FORBIDDEN_MARK_PREVIEW_LIVE_BAR } from "../voice-live/presentational-bar-actions.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("live bar wiring (no toast-only markPreview)", () => {
  it("mounts LiveVoiceBar with realtime handlers, not markPreview stubs", () => {
    const src = readFileSync(join(root, "src/components/mind/command-app.tsx"), "utf8");
    assert.match(src, /<LiveVoiceBar[\s\S]*onUserTranscript/);
    assert.match(src, /from "@\/components\/mind\/live-voice-bar"/);
    // Wired bar owns the session — command-app must not pass markPreview live-bar stubs.
    for (const label of FORBIDDEN_MARK_PREVIEW_LIVE_BAR) {
      const re = new RegExp(`markPreview\\(\\s*["']${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
      assert.equal(re.test(src), false, `command-app must not markPreview("${label}")`);
    }
  });

  it("LiveVoiceBar drives mute/end/speaker/screen via useLiveVoiceSession", () => {
    const src = readFileSync(join(root, "src/components/mind/live-voice-bar/live-voice-bar.tsx"), "utf8");
    assert.match(src, /useLiveVoiceSession/);
    assert.match(src, /live\.toggleMute/);
    assert.match(src, /live\.end/);
    assert.match(src, /live\.toggleSpeaker/);
    assert.match(src, /attachDisplayAudio/);
    assert.match(src, /onScreenClick/);
    assert.equal(/markPreview\s*\(/.test(src), false);
  });
});
