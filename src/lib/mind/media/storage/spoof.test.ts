import assert from "node:assert/strict";
import test from "node:test";
import { rejectDisguisedExecutable, sniffMime } from "./safe-name.ts";

test("a renamed executable is not accepted as an image", () => {
  const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
  assert.equal(rejectDisguisedExecutable("photo.png", bytes), true);
  assert.equal(sniffMime(bytes), "application/octet-stream");
  assert.equal(rejectDisguisedExecutable("notes.txt", bytes), false);
});
