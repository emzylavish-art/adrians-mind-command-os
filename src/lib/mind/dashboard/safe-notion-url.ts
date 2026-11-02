/**
 * Gap#58 — Notion href allowlist.
 * Only https:// on notion.so / www.notion.so / app.notion.com / *.notion.site.
 * Anything else (javascript:, data:, http:, lookalikes) is dropped or rebuilt from page id.
 */

const EXACT_HOSTS = new Set(["notion.so", "www.notion.so", "app.notion.com"]);

export function isAllowedNotionHost(hostname: string | null | undefined): boolean {
  if (!hostname || typeof hostname !== "string") return false;
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!h || h.includes(":") || h.includes("/") || h.includes(" ")) return false;
  if (EXACT_HOSTS.has(h)) return true;
  // *.notion.site (including apex notion.site)
  if (h === "notion.site") return true;
  if (h.endsWith(".notion.site")) {
    const rest = h.slice(0, -".notion.site".length);
    // reject empty / dotted tricks like ".notion.site"
    return rest.length > 0 && !rest.startsWith(".") && !rest.endsWith(".");
  }
  return false;
}

/** Canonical https URL for a Notion page id when the feed URL is untrusted. */
export function notionUrlFromPageId(pageId: string | null | undefined): string | null {
  if (!pageId || typeof pageId !== "string") return null;
  const compact = pageId.replace(/-/g, "").trim();
  if (!/^[a-f0-9]{32}$/i.test(compact)) return null;
  return `https://www.notion.so/${compact}`;
}

/**
 * Returns a safe https Notion URL, or null if the input cannot be trusted and
 * no pageId fallback is available. Never returns javascript:/data:/http:.
 */
export function sanitizeNotionHref(
  raw: unknown,
  pageId?: string | null,
): string | null {
  if (typeof raw === "string" && raw.trim()) {
    const trimmed = raw.trim();
    // Block obvious non-http(s) schemes before URL parse (and opaque parsers).
    if (/^(javascript|data|vbscript|file|blob)\s*:/i.test(trimmed)) {
      return notionUrlFromPageId(pageId);
    }
    try {
      const u = new URL(trimmed);
      if (u.protocol !== "https:") {
        return notionUrlFromPageId(pageId);
      }
      if (!isAllowedNotionHost(u.hostname)) {
        return notionUrlFromPageId(pageId);
      }
      // Strip credentials / hash abuse; keep path+query for real Notion links.
      u.username = "";
      u.password = "";
      return u.toString();
    } catch {
      return notionUrlFromPageId(pageId);
    }
  }
  return notionUrlFromPageId(pageId);
}

/** Pure focus-restore priority for Gap#57 (no DOM). */
export type FocusCandidateKind = "preferred" | "canvas" | "root" | "none";

export function pickDetailFocusRestoreKind(opts: {
  preferredOk: boolean;
  canvasOk: boolean;
  rootOk: boolean;
}): FocusCandidateKind {
  if (opts.preferredOk) return "preferred";
  if (opts.canvasOk) return "canvas";
  if (opts.rootOk) return "root";
  return "none";
}

/** A focus candidate is unsafe if it lives inside an aria-hidden tree (e.g. closed panel). */
export function isSafeFocusRestoreTarget(flags: {
  connected: boolean;
  ariaHiddenAncestor: boolean;
  disabled?: boolean;
}): boolean {
  return Boolean(flags.connected) && !flags.ariaHiddenAncestor && !flags.disabled;
}
