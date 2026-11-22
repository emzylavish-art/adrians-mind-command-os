import assert from "node:assert/strict";
import test from "node:test";
import { finishDictation } from "./system-dictation.ts";

test("Done inserts at a focused field and does not send", () => {
  const result = finishDictation({ transcript: "Hello, Adrian’s Mind", hasFocusedField: true });
  assert.equal(result.inserted, true);
  assert.match(result.note, /Nothing was sent/);
});

test("Done keeps the transcript when no field can take it", () => {
  const result = finishDictation({ transcript: "organise my files", hasFocusedField: false });
  assert.equal(result.inserted, false);
  assert.match(result.note, /organise my files/);
  assert.match(result.note, /nothing was sent/i);
});
