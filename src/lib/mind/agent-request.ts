import type { ModelTier } from "./model-tiers.ts";

export type AgentRequestSnapshot = Readonly<{ ownerId: string; operationId: string; modelTier: ModelTier; goal: string; body: string }>;
export type AgentRequestInput = { goal: string; modelTier: ModelTier; projectId: string | null; freeOnly: boolean; projects: string[]; chats: string[]; notes: string[]; images: { dataUrl: string; name?: string; origin?: string }[] };

/** A known-unsent retry reuses complete original arguments, not the currently selected chat. */
export function snapshotAgentRequest(ownerId: string, operationId: string, input: AgentRequestInput): AgentRequestSnapshot {
  if (!ownerId || !/^[A-Za-z0-9:_-]{1,160}$/.test(operationId)) throw new Error("A verified owner and valid agent operation identity are required.");
  const body = JSON.stringify({ ...input, operationId, taskId: operationId });
  if (new TextEncoder().encode(body).byteLength > 2_500_000) throw new Error("The complete agent request is too large. Reduce its attachments explicitly; nothing was sent or truncated.");
  return Object.freeze({ ownerId, operationId, modelTier: input.modelTier, goal: input.goal, body });
}

export function canRetryAgentRequest(snapshot: AgentRequestSnapshot, ownerId: string | null, result: { ok?: boolean; operationId?: string; dispatched?: unknown; retryable?: boolean }): boolean {
  return snapshot.ownerId === ownerId && result.ok === false && result.operationId === snapshot.operationId && result.dispatched === false && result.retryable !== false;
}

export function summarizeAgentModelRounds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const text = (input: unknown) => typeof input === "string" && input.trim() ? input.slice(0, 180) : "not supplied";
  return value.slice(0, 16).flatMap(row => row && typeof row === "object" && Number.isSafeInteger(row.step) && row.step > 0 && ["not_sent", "responded", "failed", "unknown"].includes(row.state)
    ? [`Step ${row.step} · ${text(row.provider)} · requested ${text(row.requestedModel)} · reported ${text(row.reportedModel)} · ${row.state.replaceAll("_", " ")} · request ID ${text(row.requestId)}. No billed amount was supplied; task output remains unverified.`] : []);
}
