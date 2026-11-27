import { readModelExecutionPlan, type ModelExecutionPlan } from "./execution-plan.ts";
import type { HelperReceipt } from "./model-consult.ts";

/** A response receipt is execution evidence, not a factual-accuracy benchmark. */
export type ExecutionEvidence = {
  version: 1;
  executionId: string;
  plan: ModelExecutionPlan | null;
  provider: string | null;
  requestedModel: string | null;
  reportedModel: string | null;
  requestId: string | null;
  resourceOperationId: string | null;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
  helpers: HelperReceipt[];
  outcome: "response_received";
  identityEvidence: "provider_reported" | "unverified";
  factualAccuracy: "unverified";
  objectiveCompletion: "unverified";
  toolReliability: "unverified";
  billingEvidence: "unverified";
};
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.slice(0, 600) : null; }
function usage(value: unknown): ExecutionEvidence["usage"] {
  if (!record(value)) return null;
  const result: NonNullable<ExecutionEvidence["usage"]> = {};
  for (const key of ["prompt_tokens", "completion_tokens"] as const) if (typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
  return Object.keys(result).length ? result : null;
}
export function readHelperReceipts(value: unknown): HelperReceipt[] {
  return !Array.isArray(value) ? [] : value.slice(0, 8).flatMap((item) => {
    if (!record(item) || !text(item.id) || !["succeeded", "failed", "canceled", "skipped"].includes(String(item.status))) return [];
    return [{ id: text(item.id)!, status: item.status as HelperReceipt["status"], contributed: item.contributed === true && item.status === "succeeded", model: text(item.model), requestedModel: text(item.requestedModel), requestId: text(item.requestId), usage: usage(item.usage), durationMs: typeof item.durationMs === "number" && Number.isFinite(item.durationMs) ? Math.max(0, item.durationMs) : 0, error: text(item.error) }];
  });
}
export function createExecutionEvidence(executionId: string, result: {
  executionPlan?: unknown; provider?: unknown; requestedModel?: unknown; model?: unknown;
  requestId?: unknown; resourceOperationId?: unknown; usage?: unknown; helperReceipts?: unknown;
}): ExecutionEvidence {
  const reported = text(result.model);
  const helpers = readHelperReceipts(result.helperReceipts);
  return { version: 1, executionId: executionId.slice(0, 200), plan: readModelExecutionPlan(result.executionPlan), provider: text(result.provider), requestedModel: text(result.requestedModel), reportedModel: reported === "model unknown" ? null : reported, requestId: text(result.requestId), resourceOperationId: text(result.resourceOperationId), usage: usage(result.usage), helpers, outcome: "response_received", identityEvidence: reported && reported !== "model unknown" ? "provider_reported" : "unverified", factualAccuracy: "unverified", objectiveCompletion: "unverified", toolReliability: "unverified", billingEvidence: "unverified" };
}
export function readExecutionEvidence(value: unknown, expectedExecutionId?: string): ExecutionEvidence | undefined {
  if (!record(value) || value.version !== 1 || typeof value.executionId !== "string" || !value.executionId || value.executionId.length > 200 || (expectedExecutionId !== undefined && value.executionId !== expectedExecutionId)) return undefined;
  return createExecutionEvidence(value.executionId, { executionPlan: value.plan, provider: value.provider, requestedModel: value.requestedModel, model: value.reportedModel, requestId: value.requestId, resourceOperationId: value.resourceOperationId, usage: value.usage, helperReceipts: value.helpers });
}
/** Join only an exact message and execution; never substitute a nearby model's usage. */
export function evaluationEvidenceForReply(rating: { messageId: string; executionId?: string; executionEvidence?: ExecutionEvidence }, replies: { id: string; executionId?: string; executionEvidence?: ExecutionEvidence }[]): { status: "matched"; evidence: ExecutionEvidence } | { status: "unavailable" } {
  const reply = replies.find((item) => item.id === rating.messageId);
  if (!reply || !rating.executionId || reply.executionId !== rating.executionId) return { status: "unavailable" };
  const evidence = readExecutionEvidence(reply.executionEvidence, rating.executionId);
  return evidence ? { status: "matched", evidence } : { status: "unavailable" };
}
