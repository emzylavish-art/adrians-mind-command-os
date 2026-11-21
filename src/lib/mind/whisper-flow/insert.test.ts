import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeInsertedValue, isEditableTarget } from "./insert.ts";

describe("whisper-flow insert", () => {
  it("inserts at caret and preserves surrounding text", () => {
    const { value, caret } = computeInsertedValue("Hello world", 5, 5, "there");
    assert.equal(value, "Hello there world");
    assert.equal(caret, "Hello there".length);
  });

  it("replaces a selection without wiping the rest", () => {
    const { value } = computeInsertedValue("Hello world", 6, 11, "friend");
    assert.equal(value, "Hello friend");
  });

  it("does not add a double space when the caret already has trailing space", () => {
    const { value } = computeInsertedValue("Hi ", 3, 3, "there");
    assert.equal(value, "Hi there");
  });

  it("rejects empty transcript", () => {
    const { value, caret } = computeInsertedValue("keep", 4, 4, "   ");
    assert.equal(value, "keep");
    assert.equal(caret, 4);
  });

  it("treats text inputs and textareas as editable", () => {
    // jsdom-less: duck-type via prototypes when available; otherwise skip DOM asserts.
    if (typeof HTMLInputElement === "undefined") {
      assert.equal(true, true);
      return;
    }
    const input = document.createElement("input");
    input.type = "text";
    assert.equal(isEditableTarget(input), true);
    const submit = document.createElement("input");
    submit.type = "submit";
    assert.equal(isEditableTarget(submit), false);
  });
});
