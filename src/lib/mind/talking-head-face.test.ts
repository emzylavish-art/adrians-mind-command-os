import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TALKING_HEAD_AVATAR, TALKING_HEAD_SOURCE, talkingHeadView } from "./talking-head-face.ts";

test("the face view uses the vendored TalkingHead sample, not a generated person", () => {
  assert.equal(talkingHeadView("full"), "full");
  assert.equal(talkingHeadView("upper"), "mid");
  assert.equal(talkingHeadView("face"), "head");
  assert.equal(talkingHeadView("compact"), "head");
  assert.equal(TALKING_HEAD_SOURCE, "https://github.com/met4citizen/TalkingHead");
  assert.equal(TALKING_HEAD_AVATAR, "/vendor/talkinghead/brunette.glb");
  const avatar = readFileSync(new URL("../../../public/vendor/talkinghead/brunette.glb", import.meta.url));
  assert.equal(avatar.subarray(0, 4).toString(), "glTF");
  const license = readFileSync(new URL("../../../vendor/talkinghead/LICENSE", import.meta.url), "utf8");
  assert.match(license, /MIT License/);
  assert.match(license, /Mika Suominen/);
});
