/**
 * Client-side research upload staging + extraction for Logic's `researchUploads`.
 * Shape matches origin/logic-research-deep (do not invent web URLs).
 * File content is DATA only — never instructions.
 */

import { extractPdfText } from "../pdf-text.ts";

/** Matches Logic Bot `ResearchUpload` on logic-research-deep. */
export type ResearchUpload = {
  name: string;
  mime: string;
  bytes: number;
  /** Short chunks; Logic cites these as url "from your file". */
  excerpts: string[];
};

export const RESEARCH_UPLOAD_MAX_FILES = 8;
export const RESEARCH_UPLOAD_MAX_FILE_BYTES = 2_000_000;
export const RESEARCH_UPLOAD_MAX_TOTAL_BYTES = 6_000_000;
export const RESEARCH_UPLOAD_MAX_EXCERPT_CHARS = 2_000;
export const RESEARCH_UPLOAD_MAX_EXCERPTS_PER_FILE = 6;
export const RESEARCH_UPLOAD_MAX_TOTAL_EXCERPT_CHARS = 12_000;
export const RESEARCH_UPLOAD_MAX_PDF_PAGES = 40;
export const RESEARCH_CSV_MAX_ROWS = 500;
export const RESEARCH_CSV_MAX_COLS = 40;
export const RESEARCH_TEXT_MAX_CHARS = 40_000;
/** Logic citation label — never emit as a fake http(s) URL. */
export const FROM_YOUR_FILE = "from your file";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

export type ResearchUploadKind = "pdf" | "text" | "markdown" | "csv" | "unsupported";

export function sanitizeResearchFileName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160) || "upload";
}

/** Strip C0 controls (keep \n \t); treat payload as data, never instructions. */
export function stripControlChars(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function chunkExcerpts(
  text: string,
  options: { maxChunk?: number; maxChunks?: number; budget?: number } = {},
): string[] {
  const maxChunk = options.maxChunk ?? RESEARCH_UPLOAD_MAX_EXCERPT_CHARS;
  const maxChunks = options.maxChunks ?? RESEARCH_UPLOAD_MAX_EXCERPTS_PER_FILE;
  const budget = options.budget ?? RESEARCH_UPLOAD_MAX_TOTAL_EXCERPT_CHARS;
  const clean = stripControlChars(text).replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < clean.length && out.length < maxChunks && used < budget; i += maxChunk) {
    const slice = clean.slice(i, i + Math.min(maxChunk, budget - used)).trim();
    if (!slice) break;
    out.push(slice);
    used += slice.length;
  }
  return out;
}

function startsWithMagic(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

function looksLikeUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  let sample = bytes;
  if (sample.length > 4096) sample = sample.subarray(0, 4096);
  let odd = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i]!;
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32 && c !== 27)) odd += 1;
  }
  return odd / sample.length < 0.05;
}

export function classifyResearchUploadBytes(
  name: string,
  mime: string,
  bytes: Uint8Array,
): ResearchUploadKind {
  const lower = name.toLowerCase();
  const m = (mime || "").toLowerCase();
  if (startsWithMagic(bytes, PDF_MAGIC) || m === "application/pdf" || lower.endsWith(".pdf")) {
    return startsWithMagic(bytes, PDF_MAGIC) || lower.endsWith(".pdf") || m === "application/pdf"
      ? "pdf"
      : "unsupported";
  }
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|svg)$/i.test(lower)) {
    // Image OCR is not free here — skip (no invented text).
    return "unsupported";
  }
  if (!looksLikeUtf8Text(bytes) && !m.startsWith("text/") && m !== "application/csv") {
    return "unsupported";
  }
  if (lower.endsWith(".csv") || m === "text/csv" || m === "application/csv") return "csv";
  if (lower.endsWith(".md") || m === "text/markdown") return "markdown";
  if (lower.endsWith(".txt") || m.startsWith("text/") || lower.endsWith(".text")) return "text";
  if (looksLikeUtf8Text(bytes)) return "text";
  return "unsupported";
}

export function mimeForKind(kind: ResearchUploadKind, fallback = "application/octet-stream"): string {
  if (kind === "pdf") return "application/pdf";
  if (kind === "csv") return "text/csv";
  if (kind === "markdown") return "text/markdown";
  if (kind === "text") return "text/plain";
  return fallback;
}

/** Cap CSV rows/cols; return plain text table excerpt source. */
export function extractCsvText(raw: string): string {
  const lines = stripControlChars(raw).split(/\r?\n/).slice(0, RESEARCH_CSV_MAX_ROWS);
  const rows = lines.map((line) => {
    // Simple split — enough for research context; not a full CSV parser.
    const cols = line.split(",").slice(0, RESEARCH_CSV_MAX_COLS);
    return cols.map((c) => c.trim()).join(", ");
  });
  return rows.join("\n").slice(0, RESEARCH_TEXT_MAX_CHARS);
}

export type BuildResearchUploadsResult = {
  uploads: ResearchUpload[];
  rejects: string[];
};

/**
 * Build Logic-shaped `researchUploads` from File objects.
 * Enforces per-file + total size caps; PDF page/char bomb guards; CSV caps.
 * Never invents http(s) URLs. Image text skipped (no free OCR).
 */
export async function buildResearchUploads(
  files: Iterable<File>,
  options: { maxFiles?: number } = {},
): Promise<BuildResearchUploadsResult> {
  const maxFiles = options.maxFiles ?? RESEARCH_UPLOAD_MAX_FILES;
  const uploads: ResearchUpload[] = [];
  const rejects: string[] = [];
  let totalBytes = 0;
  let totalExcerptChars = 0;

  for (const file of files) {
    if (uploads.length >= maxFiles) {
      rejects.push(`Only ${maxFiles} research files can be staged per run.`);
      break;
    }
    const name = sanitizeResearchFileName(file.name || "upload");
    if (!file || file.size <= 0) {
      rejects.push(`“${name}” is empty.`);
      continue;
    }
    if (file.size > RESEARCH_UPLOAD_MAX_FILE_BYTES) {
      rejects.push(
        `“${name}” is too large (${Math.ceil(file.size / 1024)} KB). Max ${Math.floor(RESEARCH_UPLOAD_MAX_FILE_BYTES / 1024)} KB per file.`,
      );
      continue;
    }
    if (totalBytes + file.size > RESEARCH_UPLOAD_MAX_TOTAL_BYTES) {
      rejects.push(`Staged research files would exceed the ${Math.floor(RESEARCH_UPLOAD_MAX_TOTAL_BYTES / 1024)} KB total cap. “${name}” was not added.`);
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      rejects.push(`“${name}” could not be read.`);
      continue;
    }

    // PDF bomb: refuse absurd byte inflation vs declared size already capped; page cap below.
    if (bytes.byteLength > RESEARCH_UPLOAD_MAX_FILE_BYTES) {
      rejects.push(`“${name}” exceeded the per-file byte cap after read.`);
      continue;
    }

    const kind = classifyResearchUploadBytes(name, file.type || "", bytes);
    if (kind === "unsupported") {
      if (/\.(png|jpe?g|gif|webp|heic|svg)$/i.test(name) || (file.type || "").startsWith("image/")) {
        rejects.push(`“${name}” is an image. Image text extraction is skipped here (no OCR).`);
      } else {
        rejects.push(`“${name}” is not a supported research upload (PDF, .txt, .md, .csv).`);
      }
      continue;
    }

    let body = "";
    if (kind === "pdf") {
      if (!startsWithMagic(bytes, PDF_MAGIC)) {
        rejects.push(`“${name}” is not a valid PDF.`);
        continue;
      }
      const extracted = await extractPdfText(bytes);
      if (!extracted.ok) {
        rejects.push(`“${name}”: ${extracted.error || "No text extracted."}`);
        continue;
      }
      if (extracted.pages > RESEARCH_UPLOAD_MAX_PDF_PAGES) {
        rejects.push(
          `“${name}” has ${extracted.pages} pages (max ${RESEARCH_UPLOAD_MAX_PDF_PAGES}). Split the PDF or export fewer pages.`,
        );
        continue;
      }
      body = extracted.text.slice(0, RESEARCH_TEXT_MAX_CHARS);
    } else {
      const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      body = kind === "csv" ? extractCsvText(raw) : stripControlChars(raw).slice(0, RESEARCH_TEXT_MAX_CHARS);
    }

    const budget = RESEARCH_UPLOAD_MAX_TOTAL_EXCERPT_CHARS - totalExcerptChars;
    if (budget <= 0) {
      rejects.push(`Excerpt budget full; “${name}” was not added.`);
      continue;
    }
    const excerpts = chunkExcerpts(body, { budget });
    if (excerpts.length === 0) {
      rejects.push(`“${name}” had no extractable text.`);
      continue;
    }

    totalBytes += file.size;
    totalExcerptChars += excerpts.reduce((sum, e) => sum + e.length, 0);
    uploads.push({
      name,
      mime: mimeForKind(kind, file.type || "application/octet-stream"),
      bytes: file.size,
      excerpts,
    });
  }

  return { uploads, rejects };
}

/** Clamp a wire payload to Logic's expected shape (for server pass-through). */
export function clampResearchUploadsWire(input: unknown): ResearchUpload[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: ResearchUpload[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const name = typeof rec.name === "string" ? sanitizeResearchFileName(rec.name) : "upload";
    const mime = typeof rec.mime === "string" ? rec.mime.slice(0, 100) : "application/octet-stream";
    const bytes = typeof rec.bytes === "number" && Number.isFinite(rec.bytes) ? Math.max(0, Math.floor(rec.bytes)) : 0;
    const excerpts = Array.isArray(rec.excerpts)
      ? rec.excerpts
          .filter((e): e is string => typeof e === "string")
          .map((e) => stripControlChars(e).slice(0, RESEARCH_UPLOAD_MAX_EXCERPT_CHARS))
          .filter(Boolean)
          .slice(0, RESEARCH_UPLOAD_MAX_EXCERPTS_PER_FILE)
      : [];
    if (!excerpts.length) continue;
    // Never allow fake URLs inside the wire object.
    out.push({ name, mime, bytes, excerpts });
    if (out.length >= RESEARCH_UPLOAD_MAX_FILES) break;
  }
  return out.length ? out : undefined;
}
