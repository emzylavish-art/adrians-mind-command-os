import { boundAbortSignal, isTimeoutAbort } from "./turn-timeouts.ts";

export type ResearchCitation = { title: string; url: string; retrievedAt?: string; query?: string; publishedAt?: string; excerpt?: string; verification?: "search-result-only" | "provider_returned" };
export type ResearchProviderIdentity = {
  id: string;
  label: string;
  strategy: "multi_query" | "single_query";
  routeFingerprint: string;
  model?: string;
};
export type ResearchDepth = "quick" | "standard" | "deep";
export type ResearchSource = ResearchCitation & {
  query: string; status: "discovered" | "snippet" | "inspected" | "inaccessible";
  excerpt: string; fetchedAt: string | null; contentHash: string | null;
  error?: string; finalUrl?: string; at?: string; providerId?: string; routeFingerprint?: string;
};
export type ResearchRoute = {
  provider: "configured-search" | "xai-web-search";
  configurationRevision: string; endpointOrigin: string | null;
  reportedModel: string | null; requestId: string | null;
};
export type ResearchStep = { query: string; ok: boolean; count: number; status?: "succeeded" | "failed" | "unattempted"; error?: string;
  retainedCount?: number;
  at?: string;
  providerId?: string;
  routeFingerprint?: string; };
export type ResearchEvidence = ResearchCitation & { query: string; at: string; verification: "provider_returned"; providerId?: string; routeFingerprint?: string };
export type ResearchAnswer = { text: string; annotations: { url: string; start: number | null; end: number | null }[] };

export function researchRetryAllowed(retryQueries: string[] | undefined, expected: string | undefined, current: ResearchProviderIdentity): boolean {
  return !retryQueries || Boolean(expected && expected === current.routeFingerprint);
}

/** Rebuild from merged records after recovery; do not replace evidence with a success counter. */
export function researchSummary(input: {
  citations: ResearchCitation[];
  steps?: ResearchStep[];
  evidence?: ResearchCitation[];
  providerIdentity?: ResearchProviderIdentity;
  attempts?: ResearchStep[];
}): string {
  const steps = input.steps ?? [];
  const failed = steps.filter((step) => !step.ok);
  const evidenceCount = new Set((input.evidence ?? input.citations).map((item) => item.url)).size;
  const lines = [input.providerIdentity?.strategy === "single_query"
    ? `${input.providerIdentity.label} returned ${input.citations.length} sources from one provider-assisted search. A multi-query research plan was not executed.`
    : `Deep research used ${steps.length} searches and kept ${input.citations.length} http(s) sources the provider returned:`];
  if (steps.length) lines.push(`${steps.length - failed.length} of ${steps.length} searches succeeded.`);
  if (failed.length) lines.push(`Missing: ${failed.map((step) => step.query).join("; ")}.`);
  if (evidenceCount > input.citations.length) lines.push(`${evidenceCount} distinct sources were returned; ${input.citations.length} are shown with coverage across queries. The remaining source records are retained as evidence.`);
  if ((input.attempts?.length ?? 0) > steps.length) lines.push(`${input.attempts!.length} query attempts are recorded, including retries.`);
  if ((input.attempts ?? steps).some((step) => /timed out/i.test(step.error ?? ""))) lines.push("Some attempts timed out; their failures remain in the attempt history.");
  lines.push(...input.citations.map((item, index) => `${index + 1}. ${item.title} — ${item.url}`));
  lines.push("Evidence level: provider-returned sources. Adrian has not independently opened or verified these pages.");
  return lines.join("\n");
}

export function withResearchProvenance(result: ResearchResult, providerIdentity: ResearchProviderIdentity, query: string): ResearchResult {
  const at = new Date().toISOString();
  const steps = (result.steps ?? [{ query, ok: result.ok, count: result.citations.length, ...(result.error ? { error: result.error } : {}) }]).map((step) => ({ ...step, at: step.at ?? at, providerId: providerIdentity.id, routeFingerprint: providerIdentity.routeFingerprint }));
  const evidence = (result.evidence ?? researchSnippets([], query, result.citations)).map(item => ({
    ...item, at: item.at ?? item.retrievedAt ?? at, verification: "provider_returned" as const,
    providerId: providerIdentity.id, routeFingerprint: providerIdentity.routeFingerprint,
  }));
  const next = { ...result, providerIdentity, steps, evidence };
  return { ...next, summary: result.ok ? researchSummary(next) : result.summary };
}
export type ResearchEvidenceReport = {
  version: 1; depth: ResearchDepth; createdAt: string;
  findings: { text: string; sourceUrls: string[]; status: "source-excerpt" | "provider-synthesis" | "unverified" }[];
  uncertainties: string[]; conflicts: { text: string; sourceUrls: string[]; status: "requires-review" }[];
  sourceDomains: number; attemptedQueries: number; unattemptedQueries: number;
};

export type ResearchResult = {
  ok: boolean;
  configured: boolean;
  citations: ResearchCitation[];
  error: string;
  /** Present when deep research ran multiple searches. */
  steps?: ResearchStep[];
  evidence?: ResearchSource[];
  report?: ResearchEvidenceReport;
  route?: ResearchRoute;
  providerAnswer?: string;
  annotatedAnswer?: ResearchAnswer;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  requestId?: string | null;
  responseId?: string | null;
  reportedModel?: string | null;
  persistence?: { saved: boolean; reportId?: string; revision?: number; error?: string };
  summary?: string;
  /** Only explicit provider citation spans; absence is not evidence for every summary claim. */
  claims?: { text: string; sourceUrls: string[]; kind: "provider-cited" }[];
  /** True when some deep-research queries timed out but real citations were kept. */
  partial?: boolean;
  providerIdentity?: ResearchProviderIdentity;
};

/** Per-query search fetch budget (ms). Override with MIND_SEARCH_TIMEOUT_MS (≥1000). */
export const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;
/** Overall deep-research budget across all queries (ms). Override with MIND_SEARCH_DEEP_TIMEOUT_MS. */
export const DEFAULT_DEEP_SEARCH_TIMEOUT_MS = 45_000;
export const MAX_SEARCH_RESPONSE_BYTES = 500_000;
export const SEARCH_TIMEOUT_REPLY = "Search timed out. No citations were created.";

function readBudgetMs(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 1_000) return fallback;
  return Math.floor(n);
}

export function searchTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  return readBudgetMs(env.MIND_SEARCH_TIMEOUT_MS, DEFAULT_SEARCH_TIMEOUT_MS);
}

export function deepSearchTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  return readBudgetMs(env.MIND_SEARCH_DEEP_TIMEOUT_MS, DEFAULT_DEEP_SEARCH_TIMEOUT_MS);
}

function sanitizeTitle(raw: string): string {
  return raw
    .replace(/\p{Cc}/gu, " ")  // C0/C1 controls + DEL; unicode property avoids no-control-regex
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Absolute http(s) URL without credentials; key is canonical for dedupe. */
function parseSafeHttpUrl(raw: string): { href: string; key: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname) return null;
  return { href: parsed.href, key: parsed.href };
}

/** Keep only titles and absolute http(s) URLs that the provider actually returned. */
export function normalizeCitations(hits: unknown, retrieval?: { query: string; retrievedAt: string }): ResearchCitation[] {
  if (!Array.isArray(hits)) return [];
  const citations: ResearchCitation[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (!hit || typeof hit !== "object") continue;
    const record = hit as { title?: unknown; url?: unknown; snippet?: unknown; description?: unknown; publishedAt?: unknown; published_at?: unknown };
    const title = typeof record.title === "string" ? sanitizeTitle(record.title) : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!title || !url) continue;
    const safe = parseSafeHttpUrl(url);
    if (!safe) continue;
    if (seen.has(safe.key)) continue;
    seen.add(safe.key);
    const excerpt = typeof record.snippet === "string" ? record.snippet : typeof record.description === "string" ? record.description : "";
    const publication = typeof record.publishedAt === "string" ? record.publishedAt : typeof record.published_at === "string" ? record.published_at : "";
    citations.push({ title, url: safe.href,
      ...(retrieval ? { query: retrieval.query, retrievedAt: retrieval.retrievedAt, verification: "search-result-only" as const } : {}),
      ...(excerpt.trim() ? { excerpt: excerpt.trim().slice(0, 2000) } : {}),
      ...(publication && Number.isFinite(Date.parse(publication)) ? { publishedAt: publication.slice(0, 100) } : {}),
    });
    if (citations.length === 8) break;
  }
  return citations;
}

/** Round-robin selection keeps later query evidence inside the same source budget. */
export function fairResearchCitations(groups: ResearchCitation[][], limit = 8): ResearchCitation[] {
  const seen = new Set<string>();
  const out: ResearchCitation[] = [];
  for (let index = 0; out.length < limit && groups.some((g) => index < g.length); index++) {
    for (const group of groups) {
      const item = group[index];
      if (!item) continue;
      const safe = parseSafeHttpUrl(item.url);
      if (!safe || seen.has(safe.key)) continue;
      seen.add(safe.key);
      out.push({ ...item, url: safe.href });
      if (out.length === limit) break;
    }
  }
  return out;
}

export function researchSnippets(hits: unknown, query: string, citations: ResearchCitation[]): ResearchSource[] {
  return citations.map((citation) => {
    const hit = Array.isArray(hits) ? hits.find((row) => row && typeof row === "object" && parseSafeHttpUrl(String(row.url ?? ""))?.href === citation.url) : null;
    const raw = hit?.snippet ?? hit?.description ?? hit?.content;
    const excerpt = typeof raw === "string" ? raw.replace(/\p{Cc}/gu, " ").trim().slice(0, 900) : "";
    return { ...citation, query, status: excerpt ? "snippet" : "discovered", excerpt, fetchedAt: null, contentHash: null };
  });
}

function dedupeCitations(items: ResearchCitation[], limit = 8): ResearchCitation[] {
  const seen = new Set<string>();
  const out: ResearchCitation[] = [];
  for (const item of items) {
    const safe = parseSafeHttpUrl(item.url);
    const key = safe?.key ?? item.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(safe ? { ...item, url: safe.href } : item);
    if (out.length === limit) break;
  }
  return out;
}

/** No search provider is configured. This never fetches a page or invents a citation. */
export function runResearch(query: string): ResearchResult {
  const text = typeof query === "string" ? query.trim() : "";
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
  const text = query.trim();
  if (!text) return [];
  const lower = text.toLowerCase();
  const plans = [text];
  if (!/\boverview\b|\bsummary\b/.test(lower)) plans.push(`${text} overview`);
  if (!/\brisk|limit|drawback|critic/.test(lower)) plans.push(`${text} risks and limitations`);
  if (!/\bcompare|vs\b|versus/.test(lower) && plans.length < 3) plans.push(`${text} comparison`);
  return [...new Set(plans)].slice(0, 3);
}

export function shouldRunDeepResearch(query: string, deepFlag?: boolean): boolean {
  if (deepFlag === true) return true;
  if (deepFlag === false) return false;
  const text = query.trim();
  if (/\bdeep research\b/i.test(text)) return true;
  return text.length >= 160;
}

function queryText(query: unknown): string {
  return typeof query === "string" ? query.trim() : "";
}

export async function performSearch(input: {
  query: string;
  endpoint?: string;
  key?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  deep?: boolean;
  timeoutMs?: number;
  deepTimeoutMs?: number;
  retryQueries?: string[];
  beforeDispatch?: () => Promise<string | null>;
}): Promise<ResearchResult> {
  const text = queryText(input.query);
  if (!text) return { ok: false, configured: false, citations: [], error: "Write what you want researched." };
  const configError = searchConfigError(input.endpoint, input.key);
  if (configError) {
    return { ok: false, configured: false, citations: [], error: configError };
  }
  if (shouldRunDeepResearch(text, input.deep)) {
    return performDeepResearch({ ...input, query: text });
  }
  return performSingleSearch({ ...input, query: text });
}

function combineSignals(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const parentSignal = parent ?? new AbortController().signal;
  return boundAbortSignal(parentSignal, timeoutMs);
}

async function performSingleSearch(input: {
  query: string;
  endpoint?: string;
  key?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  beforeDispatch?: () => Promise<string | null>;
}): Promise<ResearchResult> {
  const text = queryText(input.query);
  if (input.beforeDispatch) {
    const blocked = await input.beforeDispatch();
    if (blocked) return { ok: false, configured: true, citations: [], error: blocked };
  }
  const budget = input.timeoutMs ?? searchTimeoutMs();
  const bound = combineSignals(input.signal, budget);
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(input.endpoint!, {
      method: "POST",
      signal: bound.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${input.key}` },
      body: JSON.stringify({ query: text }),
    });
  } catch (caught) {
    if (caught instanceof Error && caught.name === "ResearchDispatchBlocked") { bound.cleanup(); return { ok: false, configured: true, citations: [], error: caught.message }; }
    if (isTimeoutAbort(bound.signal, caught) || isTimeoutAbort(bound.signal, bound.signal.reason)) {
      bound.cleanup();
      return { ok: false, configured: true, citations: [], error: SEARCH_TIMEOUT_REPLY };
    }
    bound.cleanup();
    return { ok: false, configured: true, citations: [], error: "The search provider did not answer. No citations were created." };
  }
  try {
    if (!response.ok) {
      return { ok: false, configured: true, citations: [], error: `The search provider returned ${response.status}. No citations were created.` };
    }
    let raw: string;
    try {
      raw = await response.text();
    } catch (caught) {
      if (isTimeoutAbort(bound.signal, caught) || isTimeoutAbort(bound.signal, bound.signal.reason)) {
        return { ok: false, configured: true, citations: [], error: SEARCH_TIMEOUT_REPLY };
      }
      return { ok: false, configured: true, citations: [], error: "The search provider returned an unreadable result. No citations were created." };
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_SEARCH_RESPONSE_BYTES) {
      return { ok: false, configured: true, citations: [], error: "The search provider returned a result that is too large. No citations were created." };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, configured: true, citations: [], error: "The search provider returned an unreadable result. No citations were created." };
    }
    const hits =
      payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results)
        ? (payload as { results: unknown }).results
        : [];
    const citations = normalizeCitations(hits, { query: text, retrievedAt: new Date().toISOString() });
    if (!citations.length) {
      return { ok: false, configured: true, citations: [], error: "The search returned no usable sources. No citations were created." };
    }
    const record = payload as Record<string, unknown>;
    return { ok: true, configured: true, citations, error: "", evidence: researchSnippets(hits, text, citations),
      ...(typeof record.answer === "string" ? { providerAnswer: record.answer.slice(0, 16_000) } : {}),
      requestId: response.headers.get("x-request-id"), reportedModel: typeof record.model === "string" ? record.model.slice(0, 160) : null,
    };
  } finally {
    bound.cleanup();
  }
}

/** Multi-query research: plan → several searches → synthesize citation list (no invented URLs). */
export async function performDeepResearch(input: {
  query: string;
  endpoint?: string;
  key?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  deepTimeoutMs?: number;
  retryQueries?: string[];
  beforeDispatch?: () => Promise<string | null>;
}): Promise<ResearchResult> {
  const text = queryText(input.query);
  if (!text) return { ok: false, configured: false, citations: [], error: "Write what you want researched." };
  const configError = searchConfigError(input.endpoint, input.key);
  if (configError) return { ok: false, configured: false, citations: [], error: configError };

  return runDeepResearchPlan(input, (query, signal) => performSingleSearch({
    ...input, query, signal, timeoutMs: input.timeoutMs ?? searchTimeoutMs(),
  }));
}

export async function runDeepResearchPlan(
  input: { query: string; signal?: AbortSignal; deepTimeoutMs?: number; retryQueries?: string[] },
  search: (query: string, signal: AbortSignal) => Promise<ResearchResult>,
): Promise<ResearchResult> {
  const text = input.query.trim();
  const overall = combineSignals(input.signal, input.deepTimeoutMs ?? deepSearchTimeoutMs());
  const queries = planDeepQueries(text).filter((q) => !input.retryQueries || input.retryQueries.includes(q));
  const steps: ResearchStep[] = [];
  const collected: ResearchCitation[][] = [];
  const evidence: ResearchSource[] = [];
  const answers: string[] = [];
  const claims: NonNullable<ResearchResult["claims"]> = [];
  let sawTimeout = false;
  try {
    for (const q of queries) {
      if (overall.signal.aborted) {
        const timedOut = isTimeoutAbort(overall.signal, overall.signal.reason);
        sawTimeout ||= timedOut;
        if (!collected.length) { for (const query of queries.slice(steps.length)) steps.push({ query, ok: false, count: 0, status: "unattempted" }); return { ok: false, configured: true, citations: [], error: timedOut ? SEARCH_TIMEOUT_REPLY : "Research stopped.", steps }; }
        break;
      }
      const one = await search(q, overall.signal);
      if (one.providerAnswer) answers.push(`${q}\n${one.providerAnswer.slice(0, 4000)}`);
      if (one.claims) claims.push(...one.claims);
      steps.push({ query: q, ok: one.ok, count: one.citations.length, status: one.ok ? "succeeded" : "failed", ...(one.error ? { error: one.error } : {}) });
      evidence.push(...(one.evidence ?? []));
      if (one.error === SEARCH_TIMEOUT_REPLY) {
        sawTimeout = true;
        if (isTimeoutAbort(overall.signal, overall.signal.reason)) {
          if (!collected.length) { for (const query of queries.slice(steps.length)) steps.push({ query, ok: false, count: 0, status: "unattempted" }); return { ok: false, configured: true, citations: [], error: SEARCH_TIMEOUT_REPLY, steps }; }
          break;
        }
      }
      if (one.ok) collected.push(one.citations);
    }
  } finally {
    overall.cleanup();
  }

  const citations = fairResearchCitations(collected, 8);
  if (!citations.length) {
    return {
      ok: false,
      configured: true,
      citations: [],
      error: sawTimeout
        ? SEARCH_TIMEOUT_REPLY
        : "Deep research ran but returned no usable sources. No citations were created.",
      steps,
    };
  }
  for (const query of queries.slice(steps.length)) steps.push({ query, ok: false, count: 0, status: "unattempted" });
  const retained = new Set(citations.map(item => item.url));
  const seen = new Set<string>();
  const distinct = evidence.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
  const coveredSteps = steps.map(step => ({ ...step, retainedCount: distinct.filter(item => item.query === step.query && retained.has(item.url)).length }));
  const failed = steps.filter(step => !step.ok);
  const summary = researchSummary({ citations, steps: coveredSteps, evidence: distinct });
  return {
    ok: true, configured: true, citations, error: "", steps: coveredSteps, summary, evidence: distinct,
    ...(answers.length ? { providerAnswer: answers.join("\n\n") } : {}),
    ...(claims.length ? { claims } : {}),
    ...(failed.length ? { partial: true as const } : {}),
  };
}
