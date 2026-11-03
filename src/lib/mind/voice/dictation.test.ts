import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendDictationText } from "./dictation.ts";

describe("dictation helpers", () => {
  it("appends transcript into the composer without wiping existing draft", () => {
    assert.equal(appendDictationText("", "hello"), "hello");
    assert.equal(appendDictationText("Hi", "there"), "Hi there");
    assert.equal(appendDictationText("Hi ", "there"), "Hi there");
    assert.equal(appendDictationText("  ", "x"), "x");
  });
});
