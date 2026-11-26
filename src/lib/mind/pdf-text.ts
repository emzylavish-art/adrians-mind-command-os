export type PdfPageText = { page: number | null; text: string; partial: boolean };
export type PdfChunk = { id: string; page: number | null; start: number; end: number; text: string };
export type PdfText = { ok: boolean; text: string; pages: number; error: string; partial?: boolean; coverage?: string; fullText?: string; pageTexts?: PdfPageText[]; chunks?: PdfChunk[] };
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
  if (bytes.byteLength > 4_000_000) return { ok: false, text: "", pages: 0, error: "This PDF exceeds the local extraction allowance. Choose a smaller document or explicit pages." };
  const source = latin1(bytes);
  if (!source.includes("%PDF")) return { ok: false, text: "", pages: 0, error: "That file is not a PDF. Nothing was extracted." };
  if (/\/Encrypt\b/.test(source)) return { ok: false, text: "", pages: 0, error: "Encrypted PDFs require an unlocked text copy. No text was invented." };
  const pages = source.match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
  const objects = new Map<string, string>();
  for (const match of source.matchAll(/(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g)) {
    objects.set(match[1] + " " + match[2], match[3]);
  }
  const refKeys = (fragment: string) => [...fragment.matchAll(/(\d+)\s+(\d+)\s+R\b/g)].map((m) => m[1] + " " + m[2]);
  const catalog = [...objects.values()].find((entry) => /\/Type\s*\/Catalog\b/.test(entry));
  const tree = catalog?.match(/\/Pages\s+(\d+\s+\d+\s+R)/)?.[1];
  const ordered: string[] = [];
  const seen = new Set<string>();
  const stack = tree ? refKeys(tree) : [];
  while (stack.length) {
    const key = stack.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = objects.get(key) || "";
    if (/\/Type\s*\/Page\b/.test(node)) ordered.push(node);
    else stack.push(...refKeys(node.match(/\/Kids\s*\[([^\]]*)\]/)?.[1] || "").reverse());
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
    const extracted = textFrom(content);
    return { text: extracted.text, partial: !extracted.text || extracted.partial };
  }

  const parts: string[] = [];
  const pageTexts: PdfPageText[] = [];
  const uncertain: number[] = [];
  let coverage: string | undefined;
  let collectedChars = 0;
  let retentionLimited = false;
  if (ordered.length && ordered.length === pages) {
    for (const [index, page] of ordered.entries()) {
      const refs = refKeys(page.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/)?.[1] || "");
      let incomplete = !refs.length;
      const pageParts: string[] = [];
      let pageChars = 0;
      const pageAllowance = Math.max(0, MAX_PDF_EXTRACTED_CHARS - collectedChars - (parts.length ? 2 : 0));
      for (const ref of refs) {
        const remaining = Math.max(0, pageAllowance - pageChars - (pageParts.length ? 1 : 0));
        if (!remaining) { retentionLimited = true; incomplete = true; break; }
        const decoded = await decodeObject(objects.get(ref) || "");
        if (decoded.text) {
          const text = decoded.text.slice(0, remaining);
          pageChars += text.length + (pageParts.length ? 1 : 0);
          pageParts.push(text);
          if (text.length < decoded.text.length) { retentionLimited = true; incomplete = true; }
        }
        if (decoded.partial) incomplete = true;
      }
      const pageText = pageParts.join("\n");
      collectedChars += pageText.length + (parts.length ? 2 : 0);
      parts.push(pageText);
      pageTexts.push({ page: index + 1, text: pageText, partial: incomplete });
      if (incomplete) uncertain.push(index + 1);
    }
    if (uncertain.length) coverage = "Incomplete text coverage on PDF pages " + uncertain.join(", ") + ".";
  } else {
    // Older or compressed page trees may have extractable text without reliable page attribution.
    for (const entry of objects.values()) {
      if (!/\bstream\r?\n/.test(entry)) continue;
      const remaining = Math.max(0, MAX_PDF_EXTRACTED_CHARS - collectedChars - (parts.length ? 2 : 0));
      if (!remaining) { retentionLimited = true; break; }
      const decoded = await decodeObject(entry);
      if (decoded.text) {
        const text = decoded.text.slice(0, remaining);
        collectedChars += text.length + (parts.length ? 2 : 0);
        if (text.length < decoded.text.length) retentionLimited = true;
        parts.push(text); pageTexts.push({ page: null, text, partial: true });
      }
    }
    coverage = "PDF page coverage could not be verified.";
  }
  if (/\/ToUnicode\b|\/Subtype\s*\/Type0\b|\/Differences\b/.test(source)) coverage = [coverage, "Custom font character maps are not fully supported; some glyphs may be unavailable."].filter(Boolean).join(" ");
  const extracted = parts.join("\n\n");
  const fullText = extracted.slice(0, MAX_PDF_EXTRACTED_CHARS);
  const text = fullText.slice(0, PDF_PREVIEW_CHARS).trim();
  if (!text.trim()) return { ok: false, text: "", pages, error: pages ? "No usable text was extracted. Scanned pages require OCR. Nothing was invented." : "No text was found in this PDF. Nothing was invented." };
  if (retentionLimited || fullText.length < extracted.length) coverage = [coverage, "The retained extracted text ends at 400,000 characters."].filter(Boolean).join(" ");
  let remaining = MAX_PDF_EXTRACTED_CHARS;
  const retainedPages = pageTexts.map((page) => {
    const text = page.text.slice(0, Math.max(0, remaining)); remaining -= text.length + 2;
    return { ...page, text, partial: page.partial || text.length < page.text.length };
  });
  return { ok: true, text, fullText, pages, pageTexts: retainedPages, chunks: chunkPdfPages(retainedPages), error: "", ...(coverage ? { partial: true, coverage } : {}) };
}
