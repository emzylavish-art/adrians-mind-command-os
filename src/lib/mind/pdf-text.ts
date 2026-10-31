export type PdfText = { ok: boolean; text: string; pages: number; error: string };

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
    const stream = new DecompressionStream("deflate");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    await writer.write(data as BufferSource);
    await writer.close();
    const chunks: Uint8Array[] = [];
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      if (step.value) chunks.push(step.value);
    }
    const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
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
  const streams = source.matchAll(/stream\r?\n([\s\S]*?)endstream/g);
  for (const match of streams) {
    const raw = match[1] ?? "";
    const before = source.slice(Math.max(0, (match.index ?? 0) - 240), match.index ?? 0);
    let content = raw;
    if (before.includes("/FlateDecode")) {
      const inflated = await inflate(Uint8Array.from(raw, (char) => char.charCodeAt(0)));
      if (!inflated) continue;
      content = latin1(inflated);
    }
    parts.push(...stringsFrom(content));
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 40000);
  if (!text) return { ok: false, text: "", pages, error: pages ? "No text operators were found. OCR is not configured, so a scanned page was not read. Nothing was invented." : "No text was found in this PDF. Nothing was invented." };
  return { ok: true, text, pages, error: "" };
}
