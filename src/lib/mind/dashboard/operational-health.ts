import type { AgentRun } from "../fleet.ts";

export type OperationalState = "observed" | "needs_attention" | "unverified" | "unavailable";
export type RuntimeComponent = { id: string; label: string; state: OperationalState; basis: "passive_receipt" | "readiness" | "unmeasured"; lastVerifiedAt: string | null; detail: string };
export type OperationalHealth = {
  generatedAt: string;
  revision: string | null;
  windowHours: number;
  population: string;
  components: RuntimeComponent[];
  metrics: { acknowledged: number; failed: number; unknown: number; pending: number; invalidTiming: number; requestSuccessRate: number | null; latencySampleCount: number; medianLatencyMs: number | null; p95LatencyMs: number | null; terminalRuns: number; completedRuns: number; verifiedObjectives: number; completionRate: number | null; oldestQueueAgeMs: number | null; lastSnapshotWriteAt: string | null };
  history: Array<{ operationId: string; at: string; state: string; provider: string | null; latencyMs: number | null }>;
};

const time = (value?: string | null) => { const number = value ? Date.parse(value) : NaN; return Number.isFinite(number) ? number : null; };
const percentile = (sorted: number[], p: number) => sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;

/** Passive, owner-scoped evidence. A saved authorization is not a successful operation. */
export function buildOperationalHealth(input: {
  now?: number; runs: readonly AgentRun[]; storageReadable: boolean; snapshotUpdatedAt?: string | null;
  revision?: string | null; worker: { state: "local" | "offline"; detail: string; heartbeatAt?: string | null };
}): OperationalHealth {
  const now = input.now ?? Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const validDate = (value?: string | null) => { const at = time(value); return at != null && at <= now ? new Date(at).toISOString() : null; };
  let invalidTiming = 0;
  const history = input.runs.flatMap(run => {
    const operation = run.externalOperation;
    const started = time(operation?.startedAt);
    if (!operation || started == null || started < cutoff || started > now) return [];
    const ended = time(operation.finishedAt);
    if ((operation.state === "succeeded" || operation.state === "failed" || operation.state === "not_sent") && (ended == null || ended < started || ended > now)) { invalidTiming++; return []; }
    const latencyMs = ended != null && ended >= started && ended <= now ? ended - started : null;
    const step = run.stepResults?.find(result => result.stepId === operation.stepId);
    return [{ operationId: operation.id, at: validDate(operation.finishedAt) ?? operation.startedAt, state: operation.state, provider: step?.receipt?.provider ?? null, latencyMs }];
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const acknowledged = history.filter(row => row.state === "succeeded").length;
  const failed = history.filter(row => row.state === "failed").length;
  const unknown = history.filter(row => row.state === "unknown").length;
  const pending = history.filter(row => row.state === "dispatching").length;
  const latency = history.filter(row => (row.state === "succeeded" || row.state === "failed") && row.latencyMs != null).map(row => row.latencyMs!).sort((a, b) => a - b);
  const terminal = input.runs.filter(run => (run.state === "completed" || run.state === "failed") && (time(run.updatedAt) ?? 0) >= cutoff && (time(run.updatedAt) ?? Infinity) <= now);
  const completedRuns = terminal.filter(run => run.state === "completed").length;
  const verifiedObjectives = terminal.filter(run => run.verification?.state === "verified").length;
  const queuedAt = input.runs.filter(run => run.state === "queued").map(run => time(run.createdAt)).filter((at): at is number => at != null && at <= now);
  const latest = history[0];
  const latestAt = latest ? time(latest.at) : null;
  const fresh = latestAt != null && now - latestAt <= 15 * 60 * 1000;
  const lastSuccess = history.find(row => row.state === "succeeded")?.at ?? null;
  const components: RuntimeComponent[] = [
    { id: "storage", label: "Saved workspace", state: input.storageReadable ? "observed" : "unavailable", basis: "readiness", lastVerifiedAt: input.storageReadable ? new Date(now).toISOString() : null, detail: input.storageReadable ? "The owner-scoped saved workspace was readable during this check. No write test was performed." : "Saved workspace data could not be read. Execution counts are unavailable." },
    { id: "connected_execution", label: "Connected execution", state: !input.storageReadable ? "unavailable" : !latest || !fresh ? "unverified" : latest.state === "succeeded" ? "observed" : "needs_attention", basis: "passive_receipt", lastVerifiedAt: lastSuccess, detail: !latest ? "No retained connected-operation receipt in the last 24 hours." : !fresh ? "The latest recorded operation is older than 15 minutes. Current availability is unverified." : latest.state === "succeeded" ? "The latest recorded operation returned its required acknowledgment. This does not prove the task objective or other providers." : latest.state === "unknown" || latest.state === "dispatching" ? "A dispatch is pending or its outcome is unknown. Inspect its receipt before retrying." : latest.state === "not_sent" ? "The latest operation was refused before provider dispatch. Resolve its policy or configuration issue, then explicitly resume with a fresh review." : "The latest recorded operation failed. Inspect its run before trying again." },
    { id: "worker", label: "Schedule worker", state: input.worker.state === "local" ? "observed" : "unverified", basis: "readiness", lastVerifiedAt: input.worker.state === "local" ? validDate(input.worker.heartbeatAt) : null, detail: input.worker.detail },
    { id: "voice", label: "Voice input and output", state: "unverified", basis: "unmeasured", lastVerifiedAt: null, detail: "No passive voice success receipt is available here. A configured key does not verify a microphone, speech engine, or device." },
    { id: "notion", label: "Notion page access", state: "unverified", basis: "unmeasured", lastVerifiedAt: null, detail: "Saved workspace authorization is shown in Connections. This health check does not call Notion or verify current page permissions." },
  ];
  return {
    generatedAt: new Date(now).toISOString(), revision: /^[a-f0-9]{40,64}$/i.test(input.revision ?? "") ? input.revision! : null,
    windowHours: 24, population: "Latest server-connected operation for each retained owner run, during the last 24 hours; not all application requests.", components,
    metrics: { acknowledged, failed, unknown, pending, invalidTiming, requestSuccessRate: acknowledged + failed ? acknowledged / (acknowledged + failed) : null, latencySampleCount: latency.length, medianLatencyMs: percentile(latency, .5), p95LatencyMs: percentile(latency, .95), terminalRuns: terminal.length, completedRuns, verifiedObjectives, completionRate: terminal.length ? completedRuns / terminal.length : null, oldestQueueAgeMs: queuedAt.length ? now - Math.min(...queuedAt) : null, lastSnapshotWriteAt: validDate(input.snapshotUpdatedAt) },
    history: history.slice(0, 50),
  };
}
