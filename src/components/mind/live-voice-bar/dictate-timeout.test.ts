import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withDictateTimeout } from "./dictate-timeout.ts";

describe("dictate-timeout", () => {
  it("rejects a hung promise with a visible message", async () => {
    const hung = new Promise<void>(() => {});
    await assert.rejects(
      () => withDictateTimeout(hung, 40, "Dictation timed out waiting for the microphone."),
      /Dictation timed out/,
    );
  });

  it("resolves when the inner promise wins", async () => {
    assert.equal(await withDictateTimeout(Promise.resolve(3), 100, "x"), 3);
  });
});
