/**
 * Gap #44 — turn Notion/tool markdown & HTML leftovers into plain operator text.
 * Reuses Gap #22 colon-unescape; never invents content.
 */
import { unescapeMarkdownIso } from "./format-when.ts";

export function sanitizeNotionPlainText(raw: unknown, max = 240): string {
  let s = unescapeMarkdownIso(raw ?? "");
  // Strip HTML tags (keep inner text)
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  // Drop common markdown headings / emphasis markers left as literals
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/[`*_~]+/g, "");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  if (max > 0 && s.length > max) s = s.slice(0, max).trimEnd();
  return s;
}
