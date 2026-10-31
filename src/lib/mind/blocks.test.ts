import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitBlocks } from "./blocks.ts";

describe("message blocks", () => {
  it("keeps prose and a fenced block separate", () => {
    const blocks = splitBlocks("Hello\n```ts\nconst n = 1;\n```\nDone");
    assert.deepEqual(blocks, [
      { kind: "text", text: "Hello\n" },
      { kind: "code", lang: "ts", code: "const n = 1;" },
      { kind: "text", text: "\nDone" },
    ]);
  });

  it("does not treat raw HTML as a tag", () => {
    const blocks = splitBlocks("<script>alert(1)</script>");
    assert.equal(blocks[0]?.kind, "text");
    if (blocks[0]?.kind === "text") assert.match(blocks[0].text, /<script>/);
  });
});
