/**
 * Safe, display-only Markdown tokenizer.
 * Never emits raw HTML. Dangerous link schemes are marked inert (no href).
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string | null; children: InlineNode[]; inert?: boolean };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: "blockquote"; children: BlockNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "table"; headers: InlineNode[][]; rows: InlineNode[][][] }
  | { type: "code"; lang: string; code: string }
  | { type: "hr" };

const DANGEROUS_SCHEME = /^(javascript|data|vbscript|file):/i;

/** Return a safe href, or null when the URL must be inert. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  // Browsers strip ASCII whitespace/control chars inside a scheme ("java\tscript:"),
  // so check the scheme on a normalized copy.
  // eslint-disable-next-line no-control-regex
  const normalized = href.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  if (DANGEROUS_SCHEME.test(normalized)) return null;
  // Bare schemes we don't recognize → inert
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) && !/^(https?:|mailto:|tel:)/i.test(normalized)) {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(href)) return null;
  return href;
}

function parseInlines(source: string): InlineNode[] {
  const out: InlineNode[] = [];
  let i = 0;
  // Markers known to have no further occurrence — keeps huge/unbalanced replies linear-ish.
  const exhausted = new Set<string>();
  const find = (marker: string, from: number): number => {
    if (exhausted.has(marker)) return -1;
    const at = source.indexOf(marker, from);
    if (at === -1) exhausted.add(marker);
    return at;
  };
  const pushText = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.type === "text") last.value += value;
    else out.push({ type: "text", value });
  };

  while (i < source.length) {
    // inline code
    if (source[i] === "`") {
      const end = find("`", i + 1);
      if (end !== -1) {
        out.push({ type: "code", value: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // links [text](url)
    if (source[i] === "[") {
      const close = find("]", i + 1);
      if (close !== -1 && source[close + 1] === "(") {
        const urlEnd = find(")", close + 2);
        if (urlEnd !== -1) {
          const label = source.slice(i + 1, close);
          const url = source.slice(close + 2, urlEnd);
          const href = safeHref(url);
          out.push({
            type: "link",
            href,
            inert: href === null,
            children: parseInlines(label),
          });
          i = urlEnd + 1;
          continue;
        }
      }
    }
    // strong ** or __
    if ((source[i] === "*" && source[i + 1] === "*") || (source[i] === "_" && source[i + 1] === "_")) {
      const marker = source.slice(i, i + 2);
      const end = find(marker, i + 2);
      if (end !== -1) {
        out.push({ type: "strong", children: parseInlines(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    // em * or _
    if (source[i] === "*" || source[i] === "_") {
      const marker = source[i]!;
      const end = find(marker, i + 1);
      if (end !== -1 && end > i + 1) {
        out.push({ type: "em", children: parseInlines(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    // escape HTML-looking characters as plain text (renderer also text-escapes)
    pushText(source[i]!);
    i += 1;
  }
  return out;
}

function isTableSeparator(line: string): boolean {
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

/** Parse a prose (non-fenced) Markdown string into block nodes. */
export function parseMarkdownBlocks(source: string): BlockNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    const text = buf.join("\n").trim();
    if (text) blocks.push({ type: "paragraph", children: parseInlines(text) });
    buf.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // hr
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // heading
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = Math.min(6, heading[1]!.length) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: "heading", level, children: parseInlines(heading[2]!) });
      i += 1;
      continue;
    }

    // blockquote
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "blockquote", children: parseMarkdownBlocks(quoteLines.join("\n")) });
      continue;
    }

    // table (header + separator)
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1] ?? "")
    ) {
      const headers = splitTableRow(line).map((c) => parseInlines(c));
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim()) {
        rows.push(splitTableRow(lines[i] ?? "").map((c) => parseInlines(c)));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // unordered list
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && /^[-*+]\s+/.test((lines[i] ?? "").trim())) {
        items.push(parseInlines((lines[i] ?? "").trim().replace(/^[-*+]\s+/, "")));
        i += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    // ordered list
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: InlineNode[][] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test((lines[i] ?? "").trim())) {
        items.push(parseInlines((lines[i] ?? "").trim().replace(/^\d+[.)]\s+/, "")));
        i += 1;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    // paragraph (consume until blank or structural)
    const buf: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? "";
      const t = cur.trim();
      if (!t) break;
      if (/^(#{1,6})\s+/.test(t)) break;
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) break;
      if (t.startsWith(">")) break;
      if (/^[-*+]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) break;
      if (t.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? "")) break;
      buf.push(cur);
      i += 1;
    }
    flushParagraph(buf);
  }

  return blocks;
}

/** Flatten inline nodes to plain text (for tests / a11y). */
export function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text" || n.type === "code") return n.value;
      if (n.type === "link" || n.type === "strong" || n.type === "em") return inlineText(n.children);
      return "";
    })
    .join("");
}
