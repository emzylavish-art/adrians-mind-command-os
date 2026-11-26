import { createHash, randomUUID } from "node:crypto";
import { performSearch, shouldRunDeepResearch, planDeepQueries, fairResearchCitations, type ResearchDepth, type ResearchResult, type ResearchRoute } from "./research.ts";
import { searchWithGrok } from "./xai-search.ts";
import { resolveXaiInferenceApiKey } from "./media/xai-key.ts";
import { reserveResourceOperation, settleResourceOperation } from "./resource-governor.server.ts";
import { buildEvidenceReport, enrichResearchResult } from "./research-evidence.server.ts";
import { mergeResearchEvidence } from "./research-followup.ts";
import { readResearchReport, saveResearchReport } from "./research-library.server.ts";

export type ResearchRequest = { query: string; freeOnly?: boolean; retryQueries?: string[]; researchConfigRevision?: string; depth?: ResearchDepth; reportId?: string; expectedRevision?: number; projectId?: string | null };
export function researchConfigFingerprint(input: { provider: string; endpoint: string; key: string; model?: string }): string {
  return createHash("sha256").update(JSON.stringify([input.provider, input.endpoint, input.key, input.model ?? ""])).digest("hex").slice(0, 32);
}
export function assertResearchRetry(currentRevision: string, originalRevision: string | undefined, retryQueries: string[] | undefined): void {
  if (retryQueries && (!originalRevision || originalRevision !== currentRevision)) throw new Error("The research provider or credentials changed. Start a new investigation to use this configuration; the original report remains unchanged.");
}

export async function executeResearch(owner: string, input: ResearchRequest): Promise<ResearchResult> {
  const { haltIsOn } = await import("./halt.server.ts");
  const fail = (error: string): ResearchResult => ({ ok: false, configured: false, citations: [], error });
  if (!input.query || input.query.length > 300) return fail("Provide a research question of 1 to 300 characters.");
  if (input.freeOnly) return fail("Free-only mode is active. No verified free web search route is available.");
  const endpoint = process.env.MIND_SEARCH_ENDPOINT?.trim();
  const key = process.env.MIND_SEARCH_KEY?.trim();
  const xaiKey = resolveXaiInferenceApiKey();
  if ((!endpoint || !key) && !xaiKey) return fail("No search provider is configured. Nothing was searched.");
  const configured = Boolean(endpoint && key);
  const provider = configured ? "configured-search" : "xai-web-search";
  const revision = researchConfigFingerprint({ provider, endpoint: configured ? endpoint! : "https://api.x.ai/v1/responses", key: configured ? key! : xaiKey!, model: configured ? "" : "grok-4.7" });
  let origin: string | null = null;
  try { origin = new URL(configured ? endpoint! : "https://api.x.ai/v1/responses").origin; } catch { return fail("The configured search URL is invalid."); }
  let previous: Awaited<ReturnType<typeof readResearchReport>> = null;
  try {
    assertResearchRetry(revision, input.researchConfigRevision, input.retryQueries);
    if (input.reportId) {
      previous = await readResearchReport(owner, input.reportId);
      if (!previous || previous.archived || previous.revision !== input.expectedRevision) throw new Error("The report changed or is unavailable. Reload it before continuing.");
      if (previous.question !== input.query) throw new Error("A different question needs a new research report.");
      if (input.retryQueries && previous.result.route?.configurationRevision !== revision) throw new Error("The original report used a different research configuration. Start a new investigation.");
    }
    if (await haltIsOn(owner)) throw new Error("Emergency stop is on. No new research can run.");
  } catch (error) { return fail(error instanceof Error ? error.message : "Research preflight is unavailable."); }

  const depth = input.depth ?? previous?.result.report?.depth ?? (shouldRunDeepResearch(input.query) ? "deep" : "quick");
  const taskId = input.reportId ?? randomUUID();
  // Search service charges may include per-query or tool fees. They are always unknown unless a future adapter proves them.
  const governedFetch: typeof fetch = async (url, init) => {
    let reservation: Awaited<ReturnType<typeof reserveResourceOperation>>;
    try { reservation = await reserveResourceOperation({ owner, taskId, provider, model: configured ? "web-search" : "grok-4.7-web-search", free: false, freeOnly: input.freeOnly, inputTokens: 0, outputTokens: 0, unknownCost: true, unknownTokens: !configured }); }
    catch (error) { const blocked = new Error(error instanceof Error ? error.message : "Research resource authorization is unavailable. Nothing was sent."); blocked.name = "ResearchDispatchBlocked"; throw blocked; }
    let dispatched = false;
    try {
      if (init?.signal?.aborted || await haltIsOn(owner)) throw new Error("Research stopped before search dispatch.");
      dispatched = true;
      const response = await fetch(url, init);
      await settleResourceOperation(reservation, { outcome: response.ok ? "succeeded" : "unknown", requestId: response.headers.get("x-request-id") }).catch(() => {});
      return response;
    } catch (error) {
      await settleResourceOperation(reservation, { outcome: dispatched ? "unknown" : "not_dispatched" }).catch(() => {});
      if (!dispatched && error instanceof Error) error.name = "ResearchDispatchBlocked";
      throw error;
    }
  };
  let result: ResearchResult;
  if (configured) result = await performSearch({ query: input.query, endpoint, key, deep: depth === "deep", retryQueries: input.retryQueries, fetchImpl: governedFetch });
  else if (depth === "deep") {
    const queries = planDeepQueries(input.query).filter((query) => !input.retryQueries || input.retryQueries.includes(query));
    const overall = AbortSignal.timeout(45_000);
    const attempts: ResearchResult[] = [];
    const steps: NonNullable<ResearchResult["steps"]> = [];
    for (const query of queries) {
      if (overall.aborted || await haltIsOn(owner)) { steps.push({ query, ok: false, count: 0, status: "unattempted" }); continue; }
      const one = await searchWithGrok(query, { apiKey: xaiKey!, fetchImpl: governedFetch, signal: overall });
      attempts.push(one); steps.push({ query, ok: one.ok, count: one.citations.length, status: one.ok ? "succeeded" : "failed", ...(one.error ? { error: one.error } : {}) });
    }
    const citations = fairResearchCitations(attempts.map((one) => one.citations));
    result = { ok: citations.length > 0, configured: true, citations, error: citations.length ? "" : attempts.find((one) => one.error)?.error ?? "Research stopped before a query completed.", steps,
      partial: steps.some((step) => !step.ok), evidence: attempts.flatMap((one) => one.evidence ?? []).filter((source) => citations.some((citation) => citation.url === source.url)),
      providerAnswer: attempts.map((one, index) => one.providerAnswer ? `Search ${index + 1}:\n${one.providerAnswer}` : "").filter(Boolean).join("\n\n").slice(0, 16_000),
      reportedModel: attempts.find((one) => one.reportedModel)?.reportedModel ?? null, requestId: attempts.at(-1)?.requestId ?? null,
    };
  } else result = await searchWithGrok(input.query, { apiKey: xaiKey!, fetchImpl: governedFetch });
  const route: ResearchRoute = { provider, configurationRevision: revision, endpointOrigin: origin, reportedModel: result.reportedModel ?? null, requestId: result.requestId ?? null };
  result = { ...result, route };
  if (result.ok && !await haltIsOn(owner)) result = await enrichResearchResult(result, input.query, depth);
  else result.report = buildEvidenceReport(result, depth);
  if (previous && input.retryQueries) {
    result = mergeResearchEvidence(previous.result, result);
    result.report = buildEvidenceReport(result, depth);
  }
  try {
    const saved = await saveResearchReport(owner, { question: input.query, result, ...(previous ? { reportId: previous.reportId, expectedRevision: previous.revision } : {}), projectId: input.projectId });
    result.persistence = { saved: true, ...saved };
  } catch {
    result.persistence = { saved: false, error: "The research result was produced but could not be saved. Export it before leaving this screen." };
  }
  return result;
}
