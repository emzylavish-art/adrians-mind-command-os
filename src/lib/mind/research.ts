import { boundAbortSignal, isTimeoutAbort } from "./turn-timeouts.ts";

export type ResearchCitation = { title: string; url: string };

export type ResearchResult = {
  ok: boolean;
  configured: boolean;
  citations: ResearchCitation[];
  error: string;
  /** Present when deep research ran multiple searches. */
  steps?: { query: string; ok: boolean; count: number }[];
  summary?: string;
  /** True when some deep-research queries timed out but real citations were kept. */
  partial?: boolean;
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
  parsed.hash = "";
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  const href = parsed.href;
  return { href, key: href.toLowerCase() };
}

/** Keep only titles and absolute http(s) URLs that the provider actually returned. */
export function normalizeCitations(hits: unknown): ResearchCitation[] {
  if (!Array.isArray(hits)) return [];
  const citations: ResearchCitation[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (!hit || typeof hit !== "object") continue;
    const record = hit as { title?: unknown; url?: unknown };
    const title = typeof record.title === "string" ? sanitizeTitle(record.title) : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!title || !url) continue;
    const safe = parseSafeHttpUrl(url);
    if (!safe) continue;
    if (seen.has(safe.key)) continue;
    seen.add(safe.key);
    citations.push({ title, url: safe.href });
    if (citations.length === 8) break;
  }
  return citations;
}

function dedupeCitations(items: ResearchCitation[], limit = 8): ResearchCitation[] {
  const seen = new Set<string>();
  const out: ResearchCitation[] = [];
  for (const item of items) {
    const safe = parseSafeHttpUrl(item.url);
    const key = safe?.key ?? item.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(safe ? { title: item.title, url: safe.href } : item);
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
}): Promise<ResearchResult> {
  const text = queryText(input.query);
  const budget = input.timeoutMs ?? searchTimeoutMs();
  const bound = combineSignals(input.signal, budget);
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(input.endpoint!, {
      method: "POST",
      signal: bound.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${input.key}` },
      body: JSON.stringify({ query: text.slice(0, 300) }),
    });
  } catch (caught) {
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
    const citations = normalizeCitations(hits);
    if (!citations.length) {
      return { ok: false, configured: true, citations: [], error: "The search returned no usable sources. No citations were created." };
    }
    return { ok: true, configured: true, citations, error: "" };
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
}): Promise<ResearchResult> {
  const text = queryText(input.query);
  if (!text) return { ok: false, configured: false, citations: [], error: "Write what you want researched." };
  const configError = searchConfigError(input.endpoint, input.key);
  if (configError) return { ok: false, configured: false, citations: [], error: configError };

  const overall = combineSignals(input.signal, input.deepTimeoutMs ?? deepSearchTimeoutMs());
  const perQuery = input.timeoutMs ?? searchTimeoutMs();
  const queries = planDeepQueries(text);
  const steps: { query: string; ok: boolean; count: number }[] = [];
  const collected: ResearchCitation[] = [];
  let sawTimeout = false;
  try {
    for (const q of queries) {
      if (overall.signal.aborted) {
        const timedOut = isTimeoutAbort(overall.signal, overall.signal.reason);
        return {
          ok: false,
          configured: true,
          citations: [],
          error: timedOut || sawTimeout ? SEARCH_TIMEOUT_REPLY : "Research stopped. No citations were saved as a success.",
          steps,
        };
      }
      const one = await performSingleSearch({
        ...input,
        query: q,
        signal: overall.signal,
        timeoutMs: perQuery,
      });
      steps.push({ query: q, ok: one.ok, count: one.citations.length });
      if (one.error === SEARCH_TIMEOUT_REPLY) {
        sawTimeout = true;
        if (isTimeoutAbort(overall.signal, overall.signal.reason)) {
          return { ok: false, configured: true, citations: [], error: SEARCH_TIMEOUT_REPLY, steps };
        }
      }
      if (one.ok) collected.push(...one.citations);
    }
  } finally {
    overall.cleanup();
  }

  const citations = dedupeCitations(collected, 8);
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
  const summaryLines = [
    `Deep research used ${steps.length} searches and kept ${citations.length} http(s) sources the provider returned:`,
    ...citations.map((item, index) => `${index + 1}. ${item.title} — ${item.url}`),
  ];
  if (sawTimeout) {
    summaryLines.push("Note: some searches timed out; only confirmed sources are listed.");
  }
  const summary = summaryLines.join("\n");
  return {
    ok: true,
    configured: true,
    citations,
    error: "",
    steps,
    summary,
    ...(sawTimeout ? { partial: true as const } : {}),
  };
}
