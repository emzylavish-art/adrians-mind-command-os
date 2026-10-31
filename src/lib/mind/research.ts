export type ResearchCitation = { title: string; url: string };

export type ResearchResult = {
  ok: false;
  configured: false;
  citations: ResearchCitation[];
  error: string;
};

/** No search provider is configured. This never fetches a page or invents a citation. */
export function runResearch(query: string): ResearchResult {
  const text = query.trim();
  if (!text) {
    return { ok: false, configured: false, citations: [], error: "Write what you want researched." };
  }
  return {
    ok: false,
    configured: false,
    citations: [],
    error: "No search provider is configured. Nothing was searched and no citations were created.",
  };
}
