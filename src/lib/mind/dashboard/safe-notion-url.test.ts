import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAllowedNotionHost,
  isSafeFocusRestoreTarget,
  notionUrlFromPageId,
  pickDetailFocusRestoreKind,
  sanitizeNotionHref,
} from "./safe-notion-url.ts";

const PAGE = "01234567-89ab-cdef-0123-456789abcdef";

describe("Gap#58 Notion href allowlist", () => {
  it("allows only https Notion hosts", () => {
    assert.equal(isAllowedNotionHost("notion.so"), true);
    assert.equal(isAllowedNotionHost("www.notion.so"), true);
    assert.equal(isAllowedNotionHost("app.notion.com"), true);
    assert.equal(isAllowedNotionHost("workspace.notion.site"), true);
    assert.equal(isAllowedNotionHost("notion.site"), true);
  });

  it("rejects lookalikes, http, and non-Notion hosts", () => {
    assert.equal(isAllowedNotionHost("evil.example"), false);
    assert.equal(isAllowedNotionHost("notion.so.evil.com"), false);
    assert.equal(isAllowedNotionHost("notlon.so"), false);
    assert.equal(isAllowedNotionHost("www.notion.so.attacker.com"), false);
    assert.equal(isAllowedNotionHost(""), false);
    assert.equal(sanitizeNotionHref("http://www.notion.so/p1", PAGE), notionUrlFromPageId(PAGE));
    assert.equal(sanitizeNotionHref("http://www.notion.so/p1"), null);
    assert.equal(sanitizeNotionHref("http://evil.example/phish", PAGE), notionUrlFromPageId(PAGE));
  });

  it("neutralizes javascript:, data:, and opaque junk; falls back to page id", () => {
    assert.equal(sanitizeNotionHref("javascript:alert(1)", PAGE), notionUrlFromPageId(PAGE));
    assert.equal(sanitizeNotionHref("data:text/html,<script>alert(1)</script>", PAGE), notionUrlFromPageId(PAGE));
    assert.equal(sanitizeNotionHref("not a url", PAGE), notionUrlFromPageId(PAGE));
    assert.equal(sanitizeNotionHref(null, PAGE), notionUrlFromPageId(PAGE));
    assert.equal(sanitizeNotionHref("javascript:alert(1)", null), null);
  });

  it("keeps real https Notion links", () => {
    const u = "https://www.notion.so/0123456789abcdef0123456789abcdef";
    assert.equal(sanitizeNotionHref(u), u);
    assert.equal(
      sanitizeNotionHref("https://app.notion.com/p/40bb95f33e42814aacf8c3281b4f528d"),
      "https://app.notion.com/p/40bb95f33e42814aacf8c3281b4f528d",
    );
    assert.match(sanitizeNotionHref("https://foo.notion.site/Page-abc") || "", /^https:\/\/foo\.notion\.site\//);
  });
});

describe("Gap#57 focus restore after Escape", () => {
  it("prefers opener, then canvas, then root; never a hidden control", () => {
    assert.equal(pickDetailFocusRestoreKind({ preferredOk: true, canvasOk: true, rootOk: true }), "preferred");
    assert.equal(pickDetailFocusRestoreKind({ preferredOk: false, canvasOk: true, rootOk: true }), "canvas");
    assert.equal(pickDetailFocusRestoreKind({ preferredOk: false, canvasOk: false, rootOk: true }), "root");
    assert.equal(pickDetailFocusRestoreKind({ preferredOk: false, canvasOk: false, rootOk: false }), "none");
    assert.equal(isSafeFocusRestoreTarget({ connected: true, ariaHiddenAncestor: true }), false);
    assert.equal(isSafeFocusRestoreTarget({ connected: true, ariaHiddenAncestor: false }), true);
  });
});
