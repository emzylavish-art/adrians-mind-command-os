export type PdfText = { ok: boolean; text: string; pages: number; error: string; partial?: boolean };

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
  const pages = source.match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
  const parts: string[] = [];
  let skippedStream = false;
  const streams = source.matchAll(/stream\r?\n([\s\S]*?)endstream/g);
  for (const match of streams) {
    const raw = match[1] ?? "";
    const before = source.slice(Math.max(0, (match.index ?? 0) - 240), match.index ?? 0);
    let content = raw;
    if (before.includes("/FlateDecode")) {
      const inflated = await inflate(Uint8Array.from(raw, (char) => char.charCodeAt(0)));
      if (!inflated) { skippedStream = true; continue; }
      content = latin1(inflated);
    }
    parts.push(...stringsFrom(content));
  }
  const extracted = parts.join(" ").replace(/\s+/g, " ").trim();
  const text = extracted.slice(0, 40000);
  if (!text) return { ok: false, text: "", pages, error: pages ? "No text operators were found. OCR is not configured, so a scanned page was not read. Nothing was invented." : "No text was found in this PDF. Nothing was invented." };
  return { ok: true, text, pages, error: "", ...(skippedStream || text.length < extracted.length ? { partial: true } : {}) };
}
