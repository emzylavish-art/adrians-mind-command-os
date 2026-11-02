import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractIsoPrefix, formatRelativeWhen, unescapeMarkdownIso } from "./format-when.ts";

describe("format-when (#22)", () => {
  it("unescapes markdown colons", () => {
    assert.equal(unescapeMarkdownIso("2026-11-01T11:46\\:30+01\\:00"), "2026-11-01T11:46:30+01:00");
  });
  it("formats relative with WAT title", () => {
    const iso = "2026-11-01T20:00:00.000Z";
    const r = formatRelativeWhen(iso, Date.parse("2026-11-01T20:12:00.000Z"));
    assert.equal(r.label, "12 min ago");
    assert.match(r.title, /WAT$/);
  });
  it("extracts iso prefix from mirror titles", () => {
    const { iso, rest } = extractIsoPrefix("2026-11-01T11:46\\:30+01\\:00 (Africa/Lagos) — done");
    assert.ok(iso && iso.includes("11:46:30"));
    assert.match(rest, /done/);
  });
});
