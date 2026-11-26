export type PdfPageText = { page: number | null; text: string; partial: boolean };
export type PdfChunk = { id: string; page: number | null; start: number; end: number; text: string };
import type { PdfEvidenceIndex, PdfPageRange } from "./pdf-evidence.ts";
export type PdfText = { ok: boolean; text: string; pages: number; error: string; partial?: boolean; coverage?: string; evidenceIndex?: PdfEvidenceIndex; extractedCharacters?: number };
export const MAX_PDF_EXTRACTED_CHARS = 400_000;
export const PDF_PREVIEW_CHARS = 40_000;
export const PDF_CHUNK_CHARS = 2_000;

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return out;
}

function unescapePdf(raw: string): string {
  return raw.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, seq: string) => {
    if (seq === "n") return "\n";
    if (seq === "r") return "\r";
    if (seq === "t") return "\t";
    if (seq === "(" || seq === ")" || seq === "\\") return seq;
    if (/^[0-7]+$/.test(seq)) return String.fromCharCode(Number.parseInt(seq, 8));
    return "";
  });
}

type PdfStringToken = { kind: "string"; text: string; unsupported: boolean };
type PdfToken = PdfStringToken | { kind: "array"; values: PdfToken[] } | { kind: "number"; value: number } | { kind: "word"; value: string };

function decodeString(raw: string, hex = false): PdfStringToken {
  let decoded = raw;
  if (hex) {
    const digits = raw.replace(/\s/g, "");
    if (!/^[0-9a-f]*$/i.test(digits)) return { kind: "string", text: "", unsupported: true };
    const padded = digits.length % 2 ? digits + "0" : digits;
    decoded = padded.replace(/../g, (pair) => String.fromCharCode(Number.parseInt(pair, 16)));
  } else decoded = unescapePdf(raw.replace(/\\(?:\r\n|\r|\n)/g, ""));
  if (decoded.charCodeAt(0) === 0xfe && decoded.charCodeAt(1) === 0xff || decoded.charCodeAt(0) === 0xff && decoded.charCodeAt(1) === 0xfe) {
    const little = decoded.charCodeAt(0) === 0xff;
    if (decoded.length % 2) return { kind: "string", text: "", unsupported: true };
    let text = "";
    for (let index = 2; index + 1 < decoded.length; index += 2) {
      const a = decoded.charCodeAt(index), b = decoded.charCodeAt(index + 1);
      text += String.fromCharCode(little ? a + (b << 8) : (a << 8) + b);
    }
    return { kind: "string", text, unsupported: false };
  }
  // Hex strings without a known character map contain glyph IDs, not reliably Unicode.
  if (hex) return { kind: "string", text: "", unsupported: true };
  for (let index = 0; index < decoded.length; index++) {
    const code = decoded.charCodeAt(index);
    if (code <= 8 || (code >= 14 && code <= 31)) return { kind: "string", text: decoded, unsupported: true };
  }
  return { kind: "string", text: decoded, unsupported: false };
}

function textFrom(content: string): { text: string; partial: boolean } {
  let cursor = 0;
  let partial = false;
  function token(): PdfToken | null {
    while (cursor < content.length && /\s/.test(content[cursor]!)) cursor++;
    if (cursor >= content.length) return null;
    if (content[cursor] === "%") { while (cursor < content.length && !/[\r\n]/.test(content[cursor]!)) cursor++; return token(); }
    const first = content[cursor++]!;
    if (first === "(") {
      let depth = 1, raw = "";
      while (cursor < content.length && depth > 0) {
        const char = content[cursor++]!;
        if (char === "\\") { raw += char; if (cursor < content.length) raw += content[cursor++]!; }
        else if (char === "(") { depth++; raw += char; }
        else if (char === ")") { depth--; if (depth) raw += char; }
        else raw += char;
      }
      const result = decodeString(raw);
      if (depth) result.unsupported = true;
      return result;
    }
    if (first === "<" && content[cursor] !== "<") {
      const end = content.indexOf(">", cursor);
      if (end < 0) { cursor = content.length; return { kind: "string", text: "", unsupported: true }; }
      const raw = content.slice(cursor, end); cursor = end + 1; return decodeString(raw, true);
    }
    if (first === "[") {
      const values: PdfToken[] = [];
      while (cursor < content.length) {
        while (/\s/.test(content[cursor] ?? "")) cursor++;
        if (content[cursor] === "]") { cursor++; break; }
        const next = token(); if (!next) break; values.push(next);
      }
      return { kind: "array", values };
    }
    let value = first;
    while (cursor < content.length && !/[\s()[\]<>]/.test(content[cursor]!)) value += content[cursor++]!;
    const numeric = Number(value);
    return value && Number.isFinite(numeric) ? { kind: "number", value: numeric } : { kind: "word", value };
  }
  const output: string[] = [];
  let operands: PdfToken[] = [];
  function render(value: PdfToken | undefined): string {
    if (!value) { partial = true; return ""; }
    if (value.kind === "string") { partial ||= value.unsupported; return value.unsupported ? "" : value.text; }
    if (value.kind === "array") return value.values.map((item) => item.kind === "number" ? item.value <= -150 ? " " : "" : render(item)).join("");
    partial = true; return "";
  }
  while (cursor < content.length) {
    const next = token(); if (!next) break;
    if (next.kind !== "word") { operands.push(next); continue; }
    if (next.value === "Tj" || next.value === "TJ" || next.value === "'" || next.value === '"') {
      if (next.value === "'" || next.value === '"') output.push("\n");
      output.push(render(operands.at(-1)));
    } else if (["Td", "TD", "T*", "ET"].includes(next.value)) output.push("\n");
    else if (next.value === "Do" || next.value === "BI") partial = true;
    operands = [];
  }
  return { text: output.join("").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim(), partial };
}

export function chunkPdfPages(pages: PdfPageText[]): PdfChunk[] {
  const chunks: PdfChunk[] = [];
  let offset = 0;
  for (const page of pages) {
    for (let start = 0; start < page.text.length; start += PDF_CHUNK_CHARS) {
      const text = page.text.slice(start, start + PDF_CHUNK_CHARS);
      chunks.push({ id: `pdf-${page.page ?? "unknown"}-${offset + start}`, page: page.page, start: offset + start, end: offset + start + text.length, text });
    }
    offset += page.text.length + 2;
  }
  return chunks;
}

/** Select bounded, page-attributed source excerpts without an extra provider call. */
export function selectPdfChunks(pdf: Pick<PdfText, "chunks" | "coverage" | "partial">, input: { query: string; maxChars: number; pages?: number[] }): { text: string; chunks: PdfChunk[]; omittedChunks: number; coverage: string } {
  const cap = Math.max(0, Math.min(40_000, Math.floor(input.maxChars)));
  const words = [...new Set(input.query.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])];
  const requested = new Set(input.pages ?? [...input.query.matchAll(/\bpage\s+(\d+)\b/gi)].map((match) => Number(match[1])));
  const all = pdf.chunks ?? [];
  const ranked = all.map((chunk, index) => ({ chunk, index, score: (chunk.page && requested.has(chunk.page) ? 10000 : 0) + words.reduce((sum, word) => sum + (chunk.text.toLowerCase().includes(word) ? word.length : 0), 0) })).sort((a, b) => b.score - a.score || a.index - b.index);
  let left = cap;
  const selected: PdfChunk[] = [];
  const excerpts: string[] = [];
  for (const { chunk } of ranked) {
    const labelFor = (end: number) => `[PDF ${chunk.page ? `page ${chunk.page}` : "page unknown"}, characters ${chunk.start}-${end}]\n`;
    const longestLabel = labelFor(chunk.end);
    if (left <= longestLabel.length) continue;
    const text = chunk.text.slice(0, left - longestLabel.length);
    if (!text) continue;
    const label = labelFor(chunk.start + text.length);
    excerpts.push(label + text);
    selected.push({ ...chunk, text, end: chunk.start + text.length });
    left -= label.length + text.length + 2;
  }
  const omittedChunks = all.length - selected.length;
  const partialChunk = selected.some((chunk) => all.find((item) => item.id === chunk.id)?.text.length !== chunk.text.length);
  const coverage = [pdf.coverage, omittedChunks || partialChunk ? `Selected ${selected.length} of ${all.length} text chunks within the request allowance; this is an excerpt, not the complete PDF.` : "All retained extracted text chunks are included."].filter(Boolean).join(" ");
  return { text: excerpts.join("\n\n"), chunks: selected, omittedChunks, coverage };
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      size += step.value.length;
      if (size > 2_000_000) {
        await reader.cancel();
        return null;
      }
      if (step.value) chunks.push(step.value);
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  } catch {
    return null;
  }
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  const source = latin1(bytes);
  if (!source.includes("%PDF")) return { ok: false, text: "", pages: 0, error: "That file is not a PDF. Nothing was extracted." };
  const objects = new Map<string, string>();
  let duplicateObject = false;
  for (const match of source.matchAll(/(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g)) {
    if (objects.has(match[1] + " " + match[2])) duplicateObject = true;
    objects.set(match[1] + " " + match[2], match[3]);
  }
  const dictionary = (entry: string) => entry.split(/\bstream\r?\n/)[0];
  const pages = [...objects.values()].filter((entry) => /\/Type\s*\/Page\b/.test(dictionary(entry))).length;
  const refKeys = (fragment: string) => [...fragment.matchAll(/(\d+)\s+(\d+)\s+R\b/g)].map((m) => m[1] + " " + m[2]);
  const catalog = [...objects.values()].map(dictionary).find((entry) => /\/Type\s*\/Catalog\b/.test(entry));
  const tree = catalog?.match(/\/Pages\s+(\d+\s+\d+\s+R)/)?.[1];
  const ordered: string[] = [];
  const seen = new Set<string>();
  const stack = tree ? refKeys(tree) : [];
  let treeReliable = Boolean(tree) && !duplicateObject && pages <= 10000;
  while (stack.length) {
    const key = stack.pop()!;
    if (seen.has(key)) { treeReliable = false; continue; }
    seen.add(key);
    const node = dictionary(objects.get(key) || "");
    if (!node) treeReliable = false;
    if (/\/Type\s*\/Page\b/.test(node)) ordered.push(node);
    else {
      const children = refKeys(node.match(/\/Kids\s*\[([^\]]*)\]/)?.[1] || "");
      if (!/\/Type\s*\/Pages\b/.test(node) || !children.length) treeReliable = false;
      stack.push(...children.reverse());
    }
  }

  async function decodeObject(entry: string) {
    const match = entry.match(/\bstream\r?\n([\s\S]*?)endstream/);
    if (!match) return { text: "", partial: true };
    const dictionary = entry.slice(0, match.index);
    let content = match[1];
    if (/\/Filter\b/.test(dictionary)) {
      if (!/\/Filter\s*(?:\/FlateDecode\b|\[\s*\/FlateDecode\s*\])/.test(dictionary)) return { text: "", partial: true };
      const inflated = await inflate(Uint8Array.from(content, (char) => char.charCodeAt(0)));
      if (!inflated) return { text: "", partial: true };
      content = latin1(inflated);
    }
    const text = stringsFrom(content).join(" ");
    // Hex glyphs, quotation operators and embedded images/forms require a fuller PDF reader.
    return { text, partial: !text || /<[\da-f\s]+>\s*(?:Tj|[^\]]*\]\s*TJ)|\)\s*['"]|\sDo\b|\bBI\b/i.test(content) };
  }

  const parts: string[] = [];
  const pageParts: { text: string; partial: boolean }[] = [];
  const uncertain: number[] = [];
  let coverage: string | undefined;
  const reliable = treeReliable && ordered.length > 0 && ordered.length === pages;
  if (reliable) {
    for (const [index, page] of ordered.entries()) {
      const refs = refKeys(page.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/)?.[1] || "");
      let incomplete = !refs.length;
      const pageText: string[] = [];
      for (const ref of refs) {
        const decoded = await decodeObject(objects.get(ref) || "");
        if (decoded.text) pageText.push(decoded.text);
        if (decoded.partial) incomplete = true;
      }
      const text = pageText.join(" ").replace(/\s+/g, " ").trim();
      pageParts.push({ text, partial: incomplete });
      if (text) parts.push(text);
      if (incomplete) uncertain.push(index + 1);
    }
    if (uncertain.length) coverage = "Incomplete text coverage on PDF pages " + uncertain.join(", ") + ".";
  } else {
    // Unresolved/compressed/ambiguous page trees cannot support invented page numbers.
    for (const entry of objects.values()) {
      if (!/\bstream\r?\n/.test(entry)) continue;
      const decoded = await decodeObject(entry);
      if (decoded.text) parts.push(decoded.text);
    }
    coverage = "PDF page coverage could not be verified.";
  }
  const extracted = parts.join(" ").replace(/\s+/g, " ").trim();
  const text = extracted.slice(0, 40000);
  const pageRanges: PdfPageRange[] = [];
  let offset = 0;
  for (const [index, part] of pageParts.entries()) {
    if (part.text && offset > 0) offset++;
    const start = offset;
    offset += part.text.length;
    const retainedStart = Math.min(start, text.length);
    const retainedEnd = Math.min(offset, text.length);
    const status: PdfPageRange["coverage"] = !part.text ? "unavailable" : retainedStart === retainedEnd ? "not-retained" : retainedEnd < offset ? "truncated" : part.partial ? "partial" : "extracted";
    pageRanges.push({ page: index + 1, start: retainedStart, end: retainedEnd, coverage: status });
  }
  const digest = async (value: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", value as BufferSource))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const evidenceIndex: PdfEvidenceIndex = { version: 1, kind: reliable ? "pdf-page-tree" : "unresolved", sourceSha256: await digest(bytes), textSha256: await digest(new TextEncoder().encode(text)), pageCount: pages, extractedCharacters: extracted.length, retainedCharacters: text.length, pages: pageRanges };
  if (!text) return { ok: false, text: "", pages, extractedCharacters: extracted.length, evidenceIndex, error: pages ? "No usable text was extracted. Scanned pages require OCR. Nothing was invented." : "No text was found in this PDF. Nothing was invented." };
  if (text.length < extracted.length) coverage = [coverage, "The text copy ends at 40,000 characters."].filter(Boolean).join(" ");
  return { ok: true, text, pages, extractedCharacters: extracted.length, evidenceIndex, error: "", ...(coverage ? { partial: true, coverage } : {}) };
}
