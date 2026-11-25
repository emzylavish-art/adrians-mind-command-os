import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { describe, it } from "node:test";
import { extractPdfText } from "./pdf-text.ts";

function bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

describe("pdf text", () => {
  it("extracts a literal string and does not invent text when none exists", async () => {
    const plain = bytes("%PDF-1.4\n1 0 obj << /Type /Page /Contents 2 0 R >> endobj\n2 0 obj << /Length 20 >> stream\n(Lake house) Tj\nendstream endobj\n");
    const found = await extractPdfText(plain);
    assert.equal(found.ok, true);
    assert.equal(found.text, "Lake house");
    assert.equal(found.pages, 1);
    const empty = await extractPdfText(bytes("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n"));
    assert.equal(empty.ok, false);
    assert.equal(empty.text, "");
    assert.match(empty.error, /Nothing was invented/);
  });

  it("inflates a compressed stream and reads only that text", async () => {
    const compressed = deflateSync(Buffer.from("(Dock) Tj"));
    const wrapped = `stream\n${Buffer.from(compressed).toString("latin1")}endstream`;
    const file = bytes(`%PDF-1.4\n1 0 obj << /Type /Page /Filter /FlateDecode >> endobj\n2 0 obj << /Filter /FlateDecode >> ${wrapped} endobj\n`);
    const found = await extractPdfText(file);
    assert.equal(found.text, "Dock");
    assert.equal(found.pages, 1);
  });
});

it("labels the actual page with unread glyphs even when objects are stored out of page order", async () => {
  const result = await extractPdfText(bytes([
    "%PDF-1.4", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [5 0 R 3 0 R] /Count 2 >> endobj",
    "3 0 obj << /Type /Page /Contents 4 0 R >> endobj",
    "4 0 obj << >> stream\n<6F6B> Tj\nendstream endobj",
    "5 0 obj << /Type /Page /Contents 6 0 R >> endobj",
    "6 0 obj << >> stream\n(Intro) Tj\nendstream endobj", "%%EOF",
  ].join("\n")));
  assert.equal(result.text, "Intro");
  assert.equal(result.partial, true);
  assert.match(result.coverage || "", /pages 2\./);
});
