const assert = require("node:assert/strict");
const test = require("node:test");
const { decideInsert, escapeSendKeys } = require("./dictation-companion.cjs");

test("Done on Windows reports insertion and does not send", () => {
  const result = decideInsert({ text: "Hello there", platform: "win32", typed: true });
  assert.equal(result.inserted, true);
  assert.match(result.note, /Nothing was sent/);
});

test("Done keeps the words when Windows did not type", () => {
  const result = decideInsert({ text: "organise my files", platform: "linux", typed: false });
  assert.equal(result.inserted, false);
  assert.equal(result.kept, "organise my files");
});

test("SendKeys special characters are escaped", () => {
  assert.equal(escapeSendKeys("a+b"), "a{+}b");
});
