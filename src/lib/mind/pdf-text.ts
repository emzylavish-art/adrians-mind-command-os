import type { PdfEvidenceIndex, PdfPageRange } from "./pdf-evidence.ts";
export type PdfText = { ok: boolean; text: string; pages: number; error: string; partial?: boolean; coverage?: string; evidenceIndex?: PdfEvidenceIndex; extractedCharacters?: number };

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

function stringsFrom(content: string): string[] {
  const found: string[] = [];
  const pattern = /\(((?:\\.|[^\\)])*)\)\s*Tj|\[([\s\S]*?)\]\s*TJ/g;
  for (const match of content.matchAll(pattern)) {
    if (match[1] != null) found.push(unescapePdf(match[1]));
    if (match[2] != null) {
      for (const piece of match[2].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) found.push(unescapePdf(piece[1] ?? ""));
    }
  }
  return found.map((item) => item.trim()).filter(Boolean);
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
