import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractPdfText, selectPdfChunks, MAX_PDF_EXTRACTED_CHARS } from "./pdf-text.ts";
const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
function document(contents: string[]) {
  return bytes(["%PDF-1.4", "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj", `2 0 obj << /Type /Pages /Kids [${contents.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${contents.length} >> endobj`, ...contents.flatMap((content, index) => [`${3 + index * 2} 0 obj << /Type /Page /Contents ${4 + index * 2} 0 R >> endobj`, `${4 + index * 2} 0 obj << >> stream\n${content}\nendstream endobj`]), "%%EOF"].join("\n"));
}

describe("C2 PDF text and source continuity", () => {
  it("AA-117 reads balanced literal strings, quoted lines and explicit Unicode strings", async () => {
    const pdf = await extractPdfText(document(["BT (A (nested) clause) Tj 0 -12 Td (Second line) ' <FEFF00480065006C006C006F> Tj ET"]));
    assert.equal(pdf.ok, true);
    assert.match(pdf.fullText!, /A \(nested\) clause/);
    assert.match(pdf.fullText!, /Second lineHello/);
    assert.match(pdf.fullText!, /\n/);
    assert.equal(pdf.partial, undefined);
  });

  it("AA-118 retains ordered page and chunk attribution instead of flattening all pages", async () => {
    const pdf = await extractPdfText(document(["(First page) Tj", "(Second page) Tj"]));
    assert.equal(pdf.fullText, "First page\n\nSecond page");
    assert.deepEqual(pdf.pageTexts?.map((page) => page.page), [1, 2]);
    assert.equal(pdf.chunks?.[1]?.page, 2);
    assert.equal(pdf.chunks?.[1]?.start, 12);
    const selected = selectPdfChunks(pdf, { query: "page 2", maxChars: 100 });
    assert.match(selected.text, /^\[PDF page 2,/);
    assert.match(selected.text, /Second page/);
  });

  it("AA-119 retains text after the preview limit and retrieves a relevant late passage", async () => {
    const pdf = await extractPdfText(document([`(${"alpha ".repeat(7000)}) Tj`, "(ZEBRA_LATE_MARKER contractual exception) Tj"]));
    assert.equal(pdf.text.length, 40_000);
    assert.ok(pdf.fullText!.length > 40_000);
    assert.match(pdf.fullText!, /ZEBRA_LATE_MARKER/);
    const selected = selectPdfChunks(pdf, { query: "ZEBRA_LATE_MARKER", maxChars: 400 });
    assert.match(selected.text, /ZEBRA_LATE_MARKER/);
    assert.ok(selected.text.length <= 400);
    assert.ok(selected.omittedChunks > 0);
    const clipped = selected.chunks.at(-1)!;
    assert.ok(selected.text.includes(`characters ${clipped.start}-${clipped.end}`));
    assert.match(selected.coverage, /excerpt, not the complete PDF/);
  });

  it("unmapped glyphs, scanned pages and encryption remain explicit limitations", async () => {
    const mixed = await extractPdfText(document(["(Readable) Tj", "<0102> Tj /Image0 Do"]));
    assert.equal(mixed.partial, true);
    assert.match(mixed.coverage!, /pages 2/);
    assert.equal(mixed.pageTexts?.[1]?.text, "");
    const scanned = await extractPdfText(document(["/Image0 Do"]));
    assert.equal(scanned.ok, false);
    assert.match(scanned.error, /OCR/);
    const encrypted = await extractPdfText(bytes("%PDF-1.4 /Encrypt 12 0 R"));
    assert.equal(encrypted.ok, false);
    assert.match(encrypted.error, /Encrypted PDFs/);
  });

  it("retained text and provider excerpts have separate bounded budgets", async () => {
    const pdf = await extractPdfText(document([`(${"x".repeat(MAX_PDF_EXTRACTED_CHARS + 100)}) Tj`]));
    assert.equal(pdf.fullText!.length, MAX_PDF_EXTRACTED_CHARS);
    assert.match(pdf.coverage!, /400,000/);
    assert.equal(selectPdfChunks(pdf, { query: "x", maxChars: 0 }).text, "");
  });
});
