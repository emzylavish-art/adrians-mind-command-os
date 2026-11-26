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

it("AA078 preserves actual page-tree order and retained text offsets across multiple streams and a scanned page", async () => {
  const result = await extractPdfText(bytes([
    "%PDF-1.4", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [7 0 R 3 0 R 5 0 R] /Count 3 >> endobj",
    "3 0 obj << /Type /Page /Contents [4 0 R 6 0 R] >> endobj",
    "4 0 obj << >> stream\n(Beta   plan) Tj\nendstream endobj",
    "5 0 obj << /Type /Page >> endobj",
    "6 0 obj << >> stream\n(Second part) Tj\nendstream endobj",
    "7 0 obj << /Type /Page /Contents 8 0 R >> endobj",
    "8 0 obj << >> stream\n(Alpha plan) Tj\nendstream endobj", "%%EOF",
  ].join("\n")));
  assert.equal(result.evidenceIndex?.kind, "pdf-page-tree");
  assert.deepEqual(result.evidenceIndex?.pages, [
    { page: 1, start: 0, end: 10, coverage: "extracted" },
    { page: 2, start: 11, end: 32, coverage: "extracted" },
    { page: 3, start: 32, end: 32, coverage: "unavailable" },
  ]);
  assert.equal(result.text.slice(11, 32), "Beta plan Second part");
  assert.equal(result.partial, true);
  assert.match(result.evidenceIndex!.sourceSha256, /^[a-f0-9]{64}$/);
});

it("AA078 clipped PDF text marks later pages as not retained and unresolved trees never get page numbers", async () => {
  const pdf = ["%PDF-1.4", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj", "2 0 obj << /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >> endobj", "3 0 obj << /Type /Page /Contents 4 0 R >> endobj", `4 0 obj << >> stream\n(${"A".repeat(41000)}) Tj\nendstream endobj`, "5 0 obj << /Type /Page /Contents 6 0 R >> endobj", "6 0 obj << >> stream\n(After cap) Tj\nendstream endobj"].join("\n");
  const result = await extractPdfText(bytes(pdf));
  assert.equal(result.text.length, 40000);
  assert.equal(result.extractedCharacters, 41010);
  assert.deepEqual(result.evidenceIndex?.pages, [{ page: 1, start: 0, end: 40000, coverage: "truncated" }, { page: 2, start: 40000, end: 40000, coverage: "not-retained" }]);
  const unresolved = await extractPdfText(bytes("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n2 0 obj << >> stream\n(Unknown page) Tj\nendstream endobj"));
  assert.equal(unresolved.evidenceIndex?.kind, "unresolved");
  assert.deepEqual(unresolved.evidenceIndex?.pages, []);
});
