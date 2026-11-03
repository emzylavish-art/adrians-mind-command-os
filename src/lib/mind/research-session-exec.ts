/**
 * Execute a ResearchSession via performSearch / performDeepResearch with onStep → timeline SSE.
 */
import {
  performDeepResearch,
  performSearch,
  type ResearchUpload,
} from "./research.ts";
import { applyResearchResult, RESEARCH_TERMINAL } from "./research-session.ts";
import {
  appendResearchEvent,
  memoryGetResearch,
  patchResearchSession,
  researchAbortController,
} from "./research-session-store.ts";
import {
  createXaiMindSearchFetch,
  resolveMindSearchBackend,
  XAI_MIND_SEARCH_ADAPTER_ENDPOINT,
} from "./xai-search-adapter.ts";

export async function runResearchSession(
  id: string,
  options: {
    env?: Record<string, string | undefined>;
    uploads?: ResearchUpload[];
    fetchImpl?: typeof fetch;
  } = {},
) {
  const session = memoryGetResearch(id);
  if (!session) return null;
  if (RESEARCH_TERMINAL.has(session.status)) return session;

  const env = options.env ?? process.env;
  const backend = resolveMindSearchBackend(env);
  if (backend.kind === "none") {
    const failed = patchResearchSession(id, {
      status: "failed",
      error: backend.error,
    });
    appendResearchEvent(id, "error", backend.error);
    return failed;
  }

  patchResearchSession(id, { status: "running" });
  appendResearchEvent(id, "status", session.mode === "deep" ? "Deep research running…" : "Search running…");

  const controller = researchAbortController(id);
  const signal = controller?.signal;

  let fetchImpl = options.fetchImpl;
  let endpoint = backend.endpoint;
  let key = backend.key;
  if (backend.kind === "xai-adapter") {
    endpoint = XAI_MIND_SEARCH_ADAPTER_ENDPOINT;
    key = backend.key;
    fetchImpl = createXaiMindSearchFetch({
      apiKey: backend.apiKey,
      model: backend.model,
      fetchImpl: options.fetchImpl,
    });
  }

  const onStep = (event: Parameters<NonNullable<Parameters<typeof performDeepResearch>[0]["onStep"]>>[0]) => {
    if (event.kind === "step_start" && event.step) {
      appendResearchEvent(id, "step_start", `Searching: ${event.step.query}`, {
        step: event.step,
        index: event.index,
        total: event.total,
      });
    } else if (event.kind === "step_done" && event.step) {
      appendResearchEvent(
        id,
        "step_done",
        event.step.ok ? `Found ${event.step.count} source(s).` : "No usable sources for this step.",
        { step: event.step, index: event.index, total: event.total },
      );
    } else if (event.kind === "partial") {
      appendResearchEvent(id, "partial", "Some steps timed out; keeping confirmed sources.");
    } else if (event.kind === "cancelled") {
      appendResearchEvent(id, "cancelled", "Cancelled.");
    }
  };

  const result =
    session.mode === "deep"
      ? await performDeepResearch({
          query: session.query,
          endpoint,
          key,
          fetchImpl,
          signal,
          plan: session.plan,
          uploads: options.uploads,
          onStep,
        })
      : await performSearch({
          query: session.query,
          endpoint,
          key,
          fetchImpl,
          signal,
          deep: false,
          uploads: options.uploads,
        });

  const current = memoryGetResearch(id);
  if (!current) return null;
  // If cancel already marked terminal with citations mid-flight, merge carefully.
  const merged = applyResearchResult(current, result);
  const next = patchResearchSession(id, merged);
  if (result.summary) appendResearchEvent(id, "summary", result.summary.slice(0, 500));
  if (!result.ok && result.error) appendResearchEvent(id, "error", result.error);
  else appendResearchEvent(id, "status", result.cancelled ? "Cancelled." : "Research finished.");
  return next ?? memoryGetResearch(id) ?? null;
}
