import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestModules } from "./module-suggestions.ts";

describe("module suggestions", () => {
  it("returns nothing for a blank composer", () => {
    assert.deepEqual(suggestModules("   "), []);
  });

  it("puts Memory in Account and does not offer the visual dashboard", () => {
    const items = suggestModules("open memory");
    assert.equal(items[0]?.view, "memory");
    assert.equal(items[0]?.category, "Account");
    assert.equal(items.some((item) => /dashboard|universe/i.test(item.label)), false);
    assert.equal(items.some((item) => item.view === "chat"), false);
  });

  it("keeps dictation out of Speak", () => {
    const items = suggestModules("dictate this note");
    assert.deepEqual(items.map((item) => item.action), ["dictate"]);
    assert.equal(items[0]?.category, "Voice");
    assert.equal(items.some((item) => item.action === "speak"), false);
  });

  it("keeps Speak out of dictation", () => {
    const items = suggestModules("speak");
    assert.equal(items.some((item) => item.action === "speak"), true);
    assert.equal(items.some((item) => item.action === "dictate"), false);
  });

  it("names Intelligence instead of Human Code", () => {
    const items = suggestModules("intelligence");
    assert.equal(items[0]?.label, "Open Intelligence");
    assert.equal(items[0]?.view, "code");
    assert.equal(items[0]?.category, "Work");
  });
});
