/**
 * Gap #44 / queue #95 — turn Notion/tool markdown & HTML leftovers into plain operator text.
 * Reuses Gap #22 colon-unescape; never invents content.
 */
import { unescapeMarkdownIso } from "./format-when.ts";

const TOOL_BOILER_RE =
  /^(?:Here is the result of ["']?fetch["']? for the Page with URL[^.]*\.\s*)+/i;

export function sanitizeNotionPlainText(raw: unknown, max = 240): string {
  let s = unescapeMarkdownIso(raw ?? "");
  // Drop tool-output boilerplate that leaks into titles/excerpts
  s = s.replace(TOOL_BOILER_RE, "");
  // Decode a few common HTML entities before tag strip (hostile <b> as &lt;b&gt;)
  s = s
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
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
