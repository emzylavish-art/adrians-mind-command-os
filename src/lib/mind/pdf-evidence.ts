export type PdfPageRange = { page: number; start: number; end: number; coverage: "extracted" | "partial" | "unavailable" | "truncated" | "not-retained" };
export type PdfEvidenceIndex = {
  version: 1;
  kind: "pdf-page-tree" | "unresolved";
  sourceSha256: string;
  textSha256: string;
  pageCount: number;
  extractedCharacters: number;
  retainedCharacters: number;
  pages: PdfPageRange[];
};
export type PdfPassageEvidence = { sourceSha256: string; textSha256: string; attribution: "page-tree" | "unavailable"; pages: PdfPageRange[] };
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** Validate persisted offsets; content digests are checked at retrieval before attribution. */
export function readPdfEvidenceIndex(value: unknown, textLength: number): PdfEvidenceIndex | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as PdfEvidenceIndex;
  if (row.version !== 1 || !["pdf-page-tree", "unresolved"].includes(row.kind) || !hash(row.sourceSha256) || !hash(row.textSha256) || !integer(row.pageCount) || row.pageCount > 10000 || !integer(row.extractedCharacters) || row.extractedCharacters < textLength || row.retainedCharacters !== textLength || !Array.isArray(row.pages)) return undefined;
  if (row.kind === "unresolved" && row.pages.length) return undefined;
  if (row.kind === "pdf-page-tree" && (row.pages.length !== row.pageCount || !row.pages.length)) return undefined;
  let lastEnd = 0;
  const pages: PdfPageRange[] = [];
  for (const [offset, page] of row.pages.entries()) {
    if (!page || page.page !== offset + 1 || !integer(page.start) || !integer(page.end) || page.start < lastEnd || page.end < page.start || page.end > textLength || !["extracted", "partial", "unavailable", "truncated", "not-retained"].includes(page.coverage)) return undefined;
    if (["unavailable", "not-retained"].includes(page.coverage) && page.start !== page.end) return undefined;
    if (["extracted", "partial", "truncated"].includes(page.coverage) && page.start === page.end) return undefined;
    lastEnd = page.end;
    pages.push({ page: page.page, start: page.start, end: page.end, coverage: page.coverage });
  }
  return { version: 1, kind: row.kind, sourceSha256: row.sourceSha256, textSha256: row.textSha256, pageCount: row.pageCount, extractedCharacters: row.extractedCharacters, retainedCharacters: row.retainedCharacters, pages };
}
export function pdfEvidenceForRange(index: PdfEvidenceIndex, start: number, end: number): PdfPassageEvidence {
  return { sourceSha256: index.sourceSha256, textSha256: index.textSha256, attribution: index.kind === "pdf-page-tree" ? "page-tree" : "unavailable", pages: index.pages.filter((page) => page.start < end && page.end > start).map((page) => ({ ...page, start: Math.max(page.start, start), end: Math.min(page.end, end) })) };
}
