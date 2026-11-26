import assert from "node:assert/strict";
import { test } from "node:test";
import { VIDEO_CAPABILITIES, videoSettingOptions, validateVideoSettings, type VideoCapabilities } from "./video-settings.ts";

test("synthetic provider capability changes limit options and validate the exact chosen settings", () => {
  const limited: VideoCapabilities = { ...VIDEO_CAPABILITIES, model: "fixture-video", durations: [5, 10], aspectRatios: ["9:16"], resolutions: ["720p"] };
  assert.deepEqual(videoSettingOptions(limited), { durations: [5, 10], aspectRatios: ["9:16"], resolutions: ["720p"] });
  assert.equal(validateVideoSettings({ duration: 7, aspectRatio: "9:16", resolution: "720p" }, limited).ok, false);
  assert.equal(validateVideoSettings({ duration: 10, aspectRatio: "16:9", resolution: "720p" }, limited).ok, false);
  assert.deepEqual(validateVideoSettings({ duration: 10, aspectRatio: "9:16", resolution: "720p" }, limited), { ok: true, settings: { duration: 10, aspectRatio: "9:16", resolution: "720p" } });
  assert.equal(validateVideoSettings({ duration: 10, aspectRatio: "9:16", resolution: "720p" }, { ...limited, durations: [5] }).ok, false);
  assert.deepEqual(videoSettingOptions({ ...limited, durations: [100, -1, 1.5] }).durations, []);
});
