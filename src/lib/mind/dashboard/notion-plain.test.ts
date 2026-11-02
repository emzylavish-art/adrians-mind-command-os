import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeNotionPlainText } from "./notion-plain.ts";

describe("sanitizeNotionPlainText (Gap#44 / queue #95)", () => {
  it("strips tags, headings, and markdown colon escapes", () => {
    const raw =
      "## 2026-11-01T11:45\\:30+01\\:00 — <b>Key minted:</b> <code>mind-command-os-voice</code>";
    const out = sanitizeNotionPlainText(raw);
    assert.equal(/<\/?b>|<\/?code>/i.test(out), false);
    assert.match(out, /Key minted/);
  });

  it("returns empty for blank input", () => {
    assert.equal(sanitizeNotionPlainText(""), "");
    assert.equal(sanitizeNotionPlainText(null), "");
  });

  it("hostile entity-encoded tags and tool boilerplate are stripped (queue #95)", () => {
    const raw =
      'Here is the result of "fetch" for the Page with URL https://www.notion.so/x. &lt;b&gt;Key minted:&lt;/b&gt; &lt;code&gt;secret&lt;/code&gt;';
    const out = sanitizeNotionPlainText(raw);
    assert.equal(/<\/?b>|<\/?code>|&lt;|&gt;/i.test(out), false);
    assert.match(out, /Key minted/);
    assert.doesNotMatch(out, /Here is the result of/i);
  });
});
