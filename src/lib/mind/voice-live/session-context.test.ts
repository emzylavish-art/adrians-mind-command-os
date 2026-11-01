import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIVE_SCREEN_FRAME_PROMPT,
  attachedImagePrompt,
  isInternalSessionPrompt,
} from "./session-context.ts";

describe("session context prompts", () => {
  it("flags internal frame/image prompts and leaves user text alone", () => {
    assert.equal(isInternalSessionPrompt(LIVE_SCREEN_FRAME_PROMPT), true);
    assert.equal(isInternalSessionPrompt(attachedImagePrompt("Photo: x")), true);
    assert.equal(isInternalSessionPrompt("hello there"), false);
    assert.equal(isInternalSessionPrompt(""), false);
  });
});
