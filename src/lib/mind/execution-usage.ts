import type { ConsultExecutionReceipt } from "./model-consult.ts";
import type { Workspace } from "./types.ts";
import { pushUsage } from "./workspace.ts";

/** Rechecking a durable receipt updates its row; it must not count another call. */
export function applyExecutionUsage(ws: Workspace, chatId: string, executions: ConsultExecutionReceipt[], at: string): Workspace {
  let next = ws;
  for (const receipt of executions) {
    const id = `usage:${receipt.executionId}`;
    const prior = next.usage.find((item) => item.id === id);
    if (prior?.outcome === "completed" && receipt.outcome !== "completed") continue;
    next = pushUsage({ ...next, usage: next.usage.filter((item) => item.id !== id) }, {
      id, chatId, at: prior?.at ?? at, operationId: receipt.parentOperationId, role: "helper",
      outcome: receipt.outcome, provider: receipt.provider, model: receipt.model,
      requestedModel: receipt.requestedModel ?? undefined, requestId: receipt.requestId,
      promptTokens: receipt.usage?.prompt_tokens ?? null, completionTokens: receipt.usage?.completion_tokens ?? null,
      executionLocation: receipt.executionLocation,
    });
  }
  return next;
}
