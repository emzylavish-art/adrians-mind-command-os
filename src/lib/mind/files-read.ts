export type FileRead = {
  format: "text" | "markdown" | "csv" | "json" | "pdf" | "image" | "other";
  analyzed: boolean;
  summary: string;
};

export function describeFile(name: string, text: string): FileRead {
  const lower = name.toLowerCase();
  const body = text.trim();
  if (/\.(png|jpe?g|gif|webp|heic)$/.test(lower)) {
    return { format: "image", analyzed: false, summary: "This image was not analyzed. No description was created." };
  }
  if (lower.endsWith(".pdf") || body.startsWith("%PDF")) {
    if (body.startsWith("%PDF") || !body) return { format: "pdf", analyzed: false, summary: "This PDF was not decoded. No text was extracted." };
    return { format: "pdf", analyzed: true, summary: `${body.length} characters were extracted from the PDF. This is the file text, not a model summary.` };
  }
  if (lower.endsWith(".csv")) {
    const rows = body ? body.split(/\r?\n/).filter((line) => line.trim()).length : 0;
    return { format: "csv", analyzed: rows > 0, summary: rows ? `${rows} text rows were read from the file you attached.` : "The CSV was empty. Nothing was analyzed." };
  }
  if (lower.endsWith(".json")) {
    try {
      const parsed = JSON.parse(body || "null") as unknown;
      const summary = Array.isArray(parsed) ? `JSON array with ${parsed.length} items.` : parsed && typeof parsed === "object" ? `JSON object with ${Object.keys(parsed).length} keys.` : "JSON value stored.";
      return { format: "json", analyzed: body.length > 0, summary };
    } catch {
      return { format: "json", analyzed: false, summary: "The file is not valid JSON. It was stored and not analyzed." };
    }
  }
  if (lower.endsWith(".md")) {
    return { format: "markdown", analyzed: body.length > 0, summary: body ? `${body.length} characters of markdown were stored.` : "The markdown file was empty." };
  }
  if (/\.(txt|js|ts|mjs)$/.test(lower) || body) {
    return { format: "text", analyzed: body.length > 0, summary: body ? `${body.length} characters of text were stored.` : "The file had no text. Nothing was analyzed." };
  }
  return { format: "other", analyzed: false, summary: "This file type is not decoded. Nothing was extracted." };
}
