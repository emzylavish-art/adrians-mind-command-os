/**
 * Search | Deep preference for Research page + composer.
 * Heuristic (phrase / long query) remains a suggestion only — never overrides an explicit choice.
 */

export type ResearchDepthMode = "search" | "deep";

export const RESEARCH_DEPTH_STORAGE_KEY = "amcos.research.depth.v1";

export function isResearchDepthMode(value: unknown): value is ResearchDepthMode {
  return value === "search" || value === "deep";
}

export function loadResearchDepth(storage: Pick<Storage, "getItem"> | null | undefined): ResearchDepthMode {
  if (!storage) return "search";
  try {
    const raw = storage.getItem(RESEARCH_DEPTH_STORAGE_KEY);
    if (isResearchDepthMode(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "search";
}

export function saveResearchDepth(
  storage: Pick<Storage, "setItem"> | null | undefined,
  mode: ResearchDepthMode,
): void {
  if (!storage) return;
  try {
    storage.setItem(RESEARCH_DEPTH_STORAGE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Suggest Deep when the query looks heavy — UI may show a hint; does not force mode. */
export function suggestDeepResearch(query: string): boolean {
  const text = typeof query === "string" ? query.trim() : "";
  if (/\bdeep research\b/i.test(text)) return true;
  return text.length >= 160;
}
