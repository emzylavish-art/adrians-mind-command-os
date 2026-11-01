import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inlineText, parseMarkdownBlocks, safeHref } from "./markdown-safe.ts";
import { copyButtonLabel } from "./copy-feedback.ts";
import { splitBlocks } from "./blocks.ts";

describe("safeHref", () => {
  it("allows https and http", () => {
    assert.equal(safeHref("https://example.com"), "https://example.com");
    assert.equal(safeHref("http://example.com/a"), "http://example.com/a");
  });

  it("marks javascript: and data: inert", () => {
    assert.equal(safeHref("javascript:alert(1)"), null);
    assert.equal(safeHref("data:text/html,<script>"), null);
    assert.equal(safeHref("vbscript:msgbox"), null);
  });
});

describe("parseMarkdownBlocks", () => {
  it("parses lists", () => {
    const blocks = parseMarkdownBlocks("- one\n- two\n1. a\n2. b");
    assert.equal(blocks[0]?.type, "list");
    if (blocks[0]?.type === "list") {
      assert.equal(blocks[0].ordered, false);
      assert.equal(blocks[0].items.length, 2);
      assert.equal(inlineText(blocks[0].items[0]!), "one");
    }
    assert.equal(blocks[1]?.type, "list");
    if (blocks[1]?.type === "list") assert.equal(blocks[1].ordered, true);
  });

  it("parses tables", () => {
    const blocks = parseMarkdownBlocks("| A | B |\n| --- | --- |\n| 1 | 2 |");
    assert.equal(blocks[0]?.type, "table");
    if (blocks[0]?.type === "table") {
      assert.equal(blocks[0].headers.length, 2);
      assert.equal(blocks[0].rows.length, 1);
      assert.equal(inlineText(blocks[0].rows[0]![0]!), "1");
    }
  });

  it("parses bold and links", () => {
    const blocks = parseMarkdownBlocks("Hello **world** and [docs](https://example.com).");
    assert.equal(blocks[0]?.type, "paragraph");
    if (blocks[0]?.type === "paragraph") {
      const strong = blocks[0].children.find((c) => c.type === "strong");
      const link = blocks[0].children.find((c) => c.type === "link");
      assert.ok(strong);
      assert.ok(link && link.type === "link" && link.href === "https://example.com");
    }
  });

  it("keeps raw HTML as text (escaped at render time)", () => {
    const blocks = parseMarkdownBlocks("<script>alert(1)</script> and <img onerror=x>");
    assert.equal(blocks[0]?.type, "paragraph");
    if (blocks[0]?.type === "paragraph") {
      const text = inlineText(blocks[0].children);
      assert.match(text, /<script>/);
      assert.match(text, /<img onerror/);
      assert.ok(
        blocks[0].children.every(
          (c) => c.type === "text" || c.type === "code" || c.type === "strong" || c.type === "em" || c.type === "link",
        ),
      );
    }
  });

  it("marks javascript: links inert", () => {
    const blocks = parseMarkdownBlocks("Click [x](javascript:alert(1))");
    assert.equal(blocks[0]?.type, "paragraph");
    if (blocks[0]?.type === "paragraph") {
      const link = blocks[0].children.find((c) => c.type === "link");
      assert.ok(link && link.type === "link");
      if (link && link.type === "link") {
        assert.equal(link.href, null);
        assert.equal(link.inert, true);
      }
    }
  });

  it("parses headings, blockquotes, and inline code", () => {
    const blocks = parseMarkdownBlocks("# Title\n\n> quote `code`\n\nDone");
    assert.equal(blocks[0]?.type, "heading");
    if (blocks[0]?.type === "heading") assert.equal(blocks[0].level, 1);
    assert.equal(blocks[1]?.type, "blockquote");
    assert.equal(blocks[2]?.type, "paragraph");
  });
});

describe("copy feedback labels", () => {
  it("shows Copied on success and Copy failed on rejection", () => {
    assert.equal(copyButtonLabel("idle"), "Copy code");
    assert.equal(copyButtonLabel("copied"), "Copied");
    assert.equal(copyButtonLabel("failed"), "Copy failed");
  });
});

describe("code fences unchanged via splitBlocks", () => {
  it("still splits fenced code the same way", () => {
    const blocks = splitBlocks("Intro\n```js\nconsole.log(1)\n```\nOutro **bold**");
    assert.deepEqual(blocks[0], { kind: "text", text: "Intro\n" });
    assert.deepEqual(blocks[1], { kind: "code", lang: "js", code: "console.log(1)" });
    assert.equal(blocks[2]?.kind, "text");
    if (blocks[2]?.kind === "text") assert.match(blocks[2].text, /\*\*bold\*\*/);
  });
});
