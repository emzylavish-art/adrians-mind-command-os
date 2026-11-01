export type ResearchCitation = { title: string; url: string };

export type ResearchResult = {
  ok: boolean;
  configured: boolean;
  citations: ResearchCitation[];
  error: string;
  /** Present when deep research ran multiple searches. */
  steps?: { query: string; ok: boolean; count: number }[];
  summary?: string;
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

function dedupeCitations(items: ResearchCitation[], limit = 8): ResearchCitation[] {
  const seen = new Set<string>();
  const out: ResearchCitation[] = [];
  for (const item of items) {
    const key = item.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length === limit) break;
  }
  return out;
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

export function searchConfigError(endpoint?: string, key?: string): string | null {
  const hasEndpoint = Boolean(endpoint?.trim());
  const hasKey = Boolean(key?.trim());
  if (hasEndpoint && hasKey) return null;
  if (!hasEndpoint && !hasKey) {
    return "No search provider is configured. Nothing was searched and no citations were created.";
  }
  if (!hasEndpoint) {
    return "MIND_SEARCH_ENDPOINT is missing. Nothing was searched and no citations were created.";
  }
  return "MIND_SEARCH_KEY is missing. Nothing was searched and no citations were created.";
}

/** Build 2–3 focused follow-up queries for deep research (no model call). */
export function planDeepQueries(query: string): string[] {
  const text = query.trim().slice(0, 300);
  if (!text) return [];
  const lower = text.toLowerCase();
  const plans = [text];
  if (!/\boverview\b|\bsummary\b/.test(lower)) plans.push(`${text} overview`);
  if (!/\brisk|limit|drawback|critic/.test(lower)) plans.push(`${text} risks and limitations`);
  if (!/\bcompare|vs\b|versus/.test(lower) && plans.length < 3) plans.push(`${text} comparison`);
  return [...new Set(plans.map((item) => item.slice(0, 300)))].slice(0, 3);
}

export function shouldRunDeepResearch(query: string, deepFlag?: boolean): boolean {
  if (deepFlag === true) return true;
  if (deepFlag === false) return false;
  const text = query.trim();
  if (/\bdeep research\b/i.test(text)) return true;
  return text.length >= 160;
}

export async function performSearch(input: {
  query: string;
  endpoint?: string;
  key?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  deep?: boolean;
}): Promise<ResearchResult> {
  const text = input.query.trim();
  if (!text) return { ok: false, configured: false, citations: [], error: "Write what you want researched." };
  const configError = searchConfigError(input.endpoint, input.key);
  if (configError) {
    return { ok: false, configured: false, citations: [], error: configError };
  }
  if (shouldRunDeepResearch(text, input.deep)) {
    return performDeepResearch(input);
  }
  return performSingleSearch(input);
}

async function performSingleSearch(input: {
  query: string;
  endpoint?: string;
  key?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ResearchResult> {
  const text = input.query.trim();
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(input.endpoint!, {
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

/** Multi-query research: plan → several searches → synthesize citation list (no invented URLs). */
export async function performDeepResearch(input: {
  query: string;
  endpoint?: string;
  key?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ResearchResult> {
  const text = input.query.trim();
  if (!text) return { ok: false, configured: false, citations: [], error: "Write what you want researched." };
  const configError = searchConfigError(input.endpoint, input.key);
  if (configError) return { ok: false, configured: false, citations: [], error: configError };

  const queries = planDeepQueries(text);
  const steps: { query: string; ok: boolean; count: number }[] = [];
  const collected: ResearchCitation[] = [];
  for (const q of queries) {
    if (input.signal?.aborted) {
      return { ok: false, configured: true, citations: [], error: "Research stopped. No citations were saved as a success.", steps };
    }
    const one = await performSingleSearch({ ...input, query: q });
    steps.push({ query: q, ok: one.ok, count: one.citations.length });
    if (one.ok) collected.push(...one.citations);
  }
  const citations = dedupeCitations(collected, 8);
  if (!citations.length) {
    return {
      ok: false,
      configured: true,
      citations: [],
      error: "Deep research ran but returned no usable sources. No citations were created.",
      steps,
    };
  }
  const summary = [
    `Deep research used ${steps.length} searches and kept ${citations.length} http(s) sources the provider returned:`,
    ...citations.map((item, index) => `${index + 1}. ${item.title} — ${item.url}`),
  ].join("\n");
  return { ok: true, configured: true, citations, error: "", steps, summary };
}
