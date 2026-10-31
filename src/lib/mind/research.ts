export type ResearchCitation = { title: string; url: string };

export type ResearchResult = {
  ok: boolean;
  configured: boolean;
  citations: ResearchCitation[];
  error: string;
};

const HTTP_URL = /^https?:\/\/\S+$/i;

/** Keep only titles and http(s) URLs that the provider actually returned. */
export function normalizeCitations(hits: unknown): ResearchCitation[] {
  if (!Array.isArray(hits)) return [];
  const citations: ResearchCitation[] = [];
  for (const hit of hits) {
    if (!hit || typeof hit !== "object") continue;
    const record = hit as { title?: unknown; url?: unknown };
    const title = typeof record.title === "string" ? record.title.trim().slice(0, 200) : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!title || !HTTP_URL.test(url)) continue;
    citations.push({ title, url });
    if (citations.length === 8) break;
  }
  return citations;
}

/** No search provider is configured. This never fetches a page or invents a citation. */
export function runResearch(query: string): ResearchResult {
  const text = query.trim();
  if (!text) return { ok: false, configured: false, citations: [], error: "Write what you want researched." };
  return {
    ok: false,
    configured: false,
    citations: [],
    error: "No search provider is configured. Nothing was searched and no citations were created.",
  };
}

export async function performSearch(input: {
  query: string;
  endpoint?: string;
  key?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ResearchResult> {
  const text = input.query.trim();
  if (!text) return { ok: false, configured: false, citations: [], error: "Write what you want researched." };
  if (!input.endpoint?.trim() || !input.key?.trim()) return runResearch(text);
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(input.endpoint, {
      method: "POST",
      signal: input.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${input.key}` },
      body: JSON.stringify({ query: text.slice(0, 300) }),
    });
  } catch {
    return { ok: false, configured: true, citations: [], error: "The search provider did not answer. No citations were created." };
  }
  if (!response.ok) {
    return { ok: false, configured: true, citations: [], error: `The search provider returned ${response.status}. No citations were created.` };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, configured: true, citations: [], error: "The search provider returned an unreadable result. No citations were created." };
  }
  const hits = payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results) ? (payload as { results: unknown }).results : [];
  const citations = normalizeCitations(hits);
  if (!citations.length) {
    return { ok: false, configured: true, citations: [], error: "The search returned no usable sources. No citations were created." };
  }
  return { ok: true, configured: true, citations, error: "" };
}
