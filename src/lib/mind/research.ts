import { boundAbortSignal, isTimeoutAbort } from "./turn-timeouts.ts";

export type ResearchCitation = { title: string; url: string; source?: "web" | "upload" };

export type ResearchStep = { query: string; ok: boolean; count: number };

export type ResearchReportSection = {
  id: string;
  title: string;
  body: string;
};

export type ResearchReport = {
  title: string;
  mode: "search" | "deep";
  query: string;
  sections: ResearchReportSection[];
  citations: ResearchCitation[];
  gaps: string[];
  partial?: boolean;
  cancelled?: boolean;
};

export type ResearchUpload = {
  name: string;
  mime: string;
  bytes: number;
  /** Short excerpts labeled for citation as "from your file". */
  excerpts: string[];
};

export type ResearchResult = {
  ok: boolean;
  configured: boolean;
  citations: ResearchCitation[];
  error: string;
  /** Present when deep research ran multiple searches. */
  steps?: ResearchStep[];
  summary?: string;
  /** True when some deep-research queries timed out but real citations were kept. */
  partial?: boolean;
  /** True when the caller aborted via AbortSignal (Cancel). */
  cancelled?: boolean;
  report?: ResearchReport;
};

/** Per-query search fetch budget (ms). Override with MIND_SEARCH_TIMEOUT_MS (≥1000). */
export const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;
/** Overall deep-research budget across all queries (ms). Override with MIND_SEARCH_DEEP_TIMEOUT_MS. */
export const DEFAULT_DEEP_SEARCH_TIMEOUT_MS = 45_000;
export const MAX_SEARCH_RESPONSE_BYTES = 500_000;
export const SEARCH_TIMEOUT_REPLY = "Search timed out. No citations were created.";
export const SEARCH_CANCELLED_REPLY = "Research was cancelled. Partial citations that were already confirmed are kept when present.";
/** Literal citation URL for upload excerpts — never invents a web URL. */
export const FROM_YOUR_FILE = "from your file";

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
    .replace(/\p{Cc}/gu, " ")
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

export function dedupeCitations(items: ResearchCitation[], limit = 8): ResearchCitation[] {
  const seen = new Set<string>();
  const out: ResearchCitation[] = [];
  for (const item of items) {
    if (item.source === "upload" || item.url === FROM_YOUR_FILE) {
      const key = `upload:${item.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title: item.title, url: FROM_YOUR_FILE, source: "upload" });
      if (out.length === limit) break;
      continue;
    }
    const safe = parseSafeHttpUrl(item.url);
    if (!safe) continue;
    if (seen.has(safe.key)) continue;
    seen.add(safe.key);
    out.push({ title: item.title, url: safe.href });
    if (out.length === limit) break;
  }
  return out;
}

/** Turn Media-supplied uploads into "from your file" citations (no invented URLs). */
export function citationsFromUploads(uploads: ResearchUpload[] | undefined, limit = 8): ResearchCitation[] {
  if (!Array.isArray(uploads) || uploads.length === 0) return [];
  const out: ResearchCitation[] = [];
  for (const file of uploads) {
    if (!file || typeof file !== "object") continue;
    const name = typeof file.name === "string" ? sanitizeTitle(file.name) : "upload";
    const excerpts = Array.isArray(file.excerpts) ? file.excerpts : [];
    for (const excerpt of excerpts) {
      if (typeof excerpt !== "string") continue;
      const body = sanitizeTitle(excerpt);
      if (!body) continue;
      out.push({
        title: `${name}: ${body}`.slice(0, 200),
        url: FROM_YOUR_FILE,
        source: "upload",
      });
      if (out.length === limit) return out;
    }
    if (excerpts.length === 0 && name) {
      out.push({ title: name, url: FROM_YOUR_FILE, source: "upload" });
      if (out.length === limit) return out;
    }
  }
  return out;
}

/** Sanitize an editable deep plan; empty → fall back to planDeepQueries(query). */
export function resolveDeepPlan(query: string, plan?: string[] | null): string[] {
  const fallback = planDeepQueries(query);
  if (!Array.isArray(plan)) return fallback;
  const cleaned = [
    ...new Set(
      plan
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 300))
        .filter(Boolean),
    ),
  ].slice(0, 5);
  return cleaned.length > 0 ? cleaned : fallback;
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

/**
 * Explicit deep flag wins. Heuristic (phrase / length) only applies when deep is undefined —
 * clients should pass deep from the Search|Deep toggle; heuristic is a suggestion only.
 */
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

function isUserCancel(signal: AbortSignal | undefined, caught?: unknown): boolean {
  if (!signal?.aborted) return false;
  if (isTimeoutAbort(signal, signal.reason) || isTimeoutAbort(signal, caught)) return false;
  return true;
}

export function buildResearchReport(input: {
  query: string;
  mode: "search" | "deep";
  citations: ResearchCitation[];
  steps?: ResearchStep[];
  partial?: boolean;
  cancelled?: boolean;
  summary?: string;
}): ResearchReport {
  const citations = dedupeCitations(input.citations, 16);
  const web = citations.filter((c) => c.source !== "upload" && c.url !== FROM_YOUR_FILE);
  const uploads = citations.filter((c) => c.source === "upload" || c.url === FROM_YOUR_FILE);
  const gaps: string[] = [];
  if (web.length === 0) gaps.push("No http(s) web sources were returned by the search provider.");
  if (input.partial) gaps.push("Some deep searches timed out; only confirmed sources are listed.");
  if (input.cancelled) gaps.push("The run was cancelled before every planned step finished.");
  if ((input.steps?.length ?? 0) > 0) {
    const failed = input.steps!.filter((s) => !s.ok);
    if (failed.length) gaps.push(`${failed.length} planned search step(s) returned no usable sources.`);
  }

  const sections: ResearchReportSection[] = [
    {
      id: "goal",
      title: "Goal",
      body: input.query.trim().slice(0, 500) || "(empty)",
    },
    {
      id: "activity",
      title: "Activity",
      body:
        input.mode === "deep"
          ? (input.steps ?? [])
              .map((s, i) => `${i + 1}. ${s.ok ? "ok" : "miss"} · ${s.count} cite(s) · ${s.query}`)
              .join("\n") || "No deep steps ran."
          : "Single search.",
    },
    {
      id: "sources",
      title: "Sources",
      body:
        citations.length === 0
          ? "None."
          : citations
              .map((c, i) =>
                c.source === "upload" || c.url === FROM_YOUR_FILE
                  ? `${i + 1}. ${c.title} — ${FROM_YOUR_FILE}`
                  : `${i + 1}. ${c.title} — ${c.url}`,
              )
              .join("\n"),
    },
  ];
  if (uploads.length) {
    sections.push({
      id: "uploads",
      title: "From your files",
      body: uploads.map((c) => `- ${c.title}`).join("\n"),
    });
  }
  if (input.summary?.trim()) {
    sections.push({ id: "summary", title: "Summary", body: input.summary.trim().slice(0, 4000) });
  }

  return {
    title: input.mode === "deep" ? "Deep research report" : "Search report",
    mode: input.mode,
    query: input.query.trim().slice(0, 500),
    sections,
    citations,
    gaps,
    ...(input.partial ? { partial: true as const } : {}),
    ...(input.cancelled ? { cancelled: true as const } : {}),
  };
}

export function researchReportToMarkdown(report: ResearchReport): string {
  const lines: string[] = [`# ${report.title}`, "", `Query: ${report.query}`, ""];
  for (const section of report.sections) {
    lines.push(`## ${section.title}`, "", section.body, "");
  }
  if (report.gaps.length) {
    lines.push("## Gaps", "", ...report.gaps.map((g) => `- ${g}`), "");
  }
  lines.push("## Citations", "");
  if (!report.citations.length) {
    lines.push("None.", "");
  } else {
    for (const c of report.citations) {
      if (c.source === "upload" || c.url === FROM_YOUR_FILE) {
        lines.push(`- ${c.title} — ${FROM_YOUR_FILE}`);
      } else {
        lines.push(`- [${c.title}](${c.url})`);
      }
    }
    lines.push("");
  }
  lines.push("_Adrian's Mind research export. URLs are only those the search provider returned._", "");
  return lines.join("\n");
}

export type ResearchStepEvent = {
  kind: "step_start" | "step_done" | "partial" | "cancelled" | "done";
  step?: ResearchStep;
  index?: number;
  total?: number;
  result?: ResearchResult;
};

export async function performSearch(input: {
  query: string;
  endpoint?: string;
  key?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  deep?: boolean;
  timeoutMs?: number;
  deepTimeoutMs?: number;
  plan?: string[] | null;
  uploads?: ResearchUpload[];
  onStep?: (event: ResearchStepEvent) => void;
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
  uploads?: ResearchUpload[];
}): Promise<ResearchResult> {
  const text = queryText(input.query);
  const uploadCites = citationsFromUploads(input.uploads);
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
    if (isUserCancel(input.signal, caught) || isUserCancel(bound.signal, caught)) {
      bound.cleanup();
      const citations = dedupeCitations(uploadCites, 8);
      const report = buildResearchReport({
        query: text,
        mode: "search",
        citations,
        cancelled: true,
      });
      return {
        ok: citations.length > 0,
        configured: true,
        citations,
        error: citations.length ? "" : SEARCH_CANCELLED_REPLY,
        cancelled: true,
        report,
      };
    }
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
      if (isUserCancel(input.signal, caught) || isUserCancel(bound.signal, caught)) {
        return { ok: false, configured: true, citations: [], error: SEARCH_CANCELLED_REPLY, cancelled: true };
      }
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
    const citations = dedupeCitations([...normalizeCitations(hits), ...uploadCites], 8);
    if (!citations.length) {
      return { ok: false, configured: true, citations: [], error: "The search returned no usable sources. No citations were created." };
    }
    const report = buildResearchReport({ query: text, mode: "search", citations });
    return { ok: true, configured: true, citations, error: "", report };
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
  plan?: string[] | null;
  uploads?: ResearchUpload[];
  onStep?: (event: ResearchStepEvent) => void;
}): Promise<ResearchResult> {
  const text = queryText(input.query);
  if (!text) return { ok: false, configured: false, citations: [], error: "Write what you want researched." };
  const configError = searchConfigError(input.endpoint, input.key);
  if (configError) return { ok: false, configured: false, citations: [], error: configError };

  const overall = combineSignals(input.signal, input.deepTimeoutMs ?? deepSearchTimeoutMs());
  const perQuery = input.timeoutMs ?? searchTimeoutMs();
  const queries = resolveDeepPlan(text, input.plan);
  const steps: ResearchStep[] = [];
  const collected: ResearchCitation[] = [...citationsFromUploads(input.uploads)];
  let sawTimeout = false;
  let cancelled = false;
  try {
    for (let i = 0; i < queries.length; i += 1) {
      const q = queries[i]!;
      if (overall.signal.aborted) {
        if (isUserCancel(input.signal) || isUserCancel(overall.signal)) {
          cancelled = true;
          input.onStep?.({ kind: "cancelled" });
        } else {
          sawTimeout = true;
        }
        break;
      }
      input.onStep?.({ kind: "step_start", index: i, total: queries.length, step: { query: q, ok: false, count: 0 } });
      const one = await performSingleSearch({
        ...input,
        query: q,
        signal: overall.signal,
        timeoutMs: perQuery,
        uploads: undefined, // already merged once at the start
      });
      const step: ResearchStep = { query: q, ok: one.ok, count: one.citations.length };
      steps.push(step);
      input.onStep?.({ kind: "step_done", index: i, total: queries.length, step });
      if (one.cancelled) {
        cancelled = true;
        break;
      }
      if (one.error === SEARCH_TIMEOUT_REPLY) {
        sawTimeout = true;
        if (isTimeoutAbort(overall.signal, overall.signal.reason)) {
          break;
        }
      }
      if (one.ok) collected.push(...one.citations);
    }
  } finally {
    overall.cleanup();
  }

  const citations = dedupeCitations(collected, 8);
  if (!citations.length) {
    const error = cancelled
      ? SEARCH_CANCELLED_REPLY
      : sawTimeout
        ? SEARCH_TIMEOUT_REPLY
        : "Deep research ran but returned no usable sources. No citations were created.";
    const result: ResearchResult = {
      ok: false,
      configured: true,
      citations: [],
      error,
      steps,
      ...(cancelled ? { cancelled: true as const } : {}),
      report: buildResearchReport({
        query: text,
        mode: "deep",
        citations: [],
        steps,
        cancelled,
        partial: sawTimeout,
      }),
    };
    input.onStep?.({ kind: "done", result });
    return result;
  }
  const summaryLines = [
    `Deep research used ${steps.length} searches and kept ${citations.length} source${citations.length === 1 ? "" : "s"}:`,
    ...citations.map((item, index) =>
      item.source === "upload" || item.url === FROM_YOUR_FILE
        ? `${index + 1}. ${item.title} — ${FROM_YOUR_FILE}`
        : `${index + 1}. ${item.title} — ${item.url}`,
    ),
  ];
  if (sawTimeout) {
    summaryLines.push("Note: some searches timed out; only confirmed sources are listed.");
  }
  if (cancelled) {
    summaryLines.push("Note: the run was cancelled; only confirmed sources are listed.");
  }
  const summary = summaryLines.join("\n");
  const result: ResearchResult = {
    ok: true,
    configured: true,
    citations,
    error: "",
    steps,
    summary,
    ...(sawTimeout ? { partial: true as const } : {}),
    ...(cancelled ? { cancelled: true as const } : {}),
    report: buildResearchReport({
      query: text,
      mode: "deep",
      citations,
      steps,
      partial: sawTimeout,
      cancelled,
      summary,
    }),
  };
  if (sawTimeout) input.onStep?.({ kind: "partial", result });
  input.onStep?.({ kind: "done", result });
  return result;
}
