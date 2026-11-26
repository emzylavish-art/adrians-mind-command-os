import type { ConsultExecutionReceipt } from "./model-consult.ts";
import type { ModelUsage } from "./stream.ts";

export type PrimaryFailureReceipt = {
  usage?: ModelUsage | null;
  requestId?: string | null;
  model?: string;
  requestedModel?: string;
  provider?: string;
  executionLocation?: "local" | "hosted";
};

function receiptText(value: unknown, max = 300): value is string {
  // Receipt identifiers must reject ASCII controls, including newlines and NUL.
  // eslint-disable-next-line no-control-regex
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
}
function receiptUsage(value: unknown): ModelUsage | null {
  const usage = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const prompt = count(usage.prompt_tokens) ? usage.prompt_tokens : undefined;
  const completion = count(usage.completion_tokens) ? usage.completion_tokens : undefined;
  return prompt === undefined && completion === undefined ? null : {
    ...(prompt === undefined ? {} : { prompt_tokens: prompt }),
    ...(completion === undefined ? {} : { completion_tokens: completion }),
  };
}

/** Do not manufacture an empty receipt when a failure has no provider metadata. */
export function readPrimaryFailureReceipt(value: unknown): PrimaryFailureReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  const receipt: PrimaryFailureReceipt = {};
  for (const key of ["provider", "model", "requestedModel"] as const) {
    if (receiptText(row[key])) receipt[key] = row[key];
  }
  if (row.requestId === null || receiptText(row.requestId)) receipt.requestId = row.requestId;
  if (row.usage === null || (row.usage && typeof row.usage === "object" && !Array.isArray(row.usage))) receipt.usage = receiptUsage(row.usage);
  if (row.executionLocation === "local" || row.executionLocation === "hosted") receipt.executionLocation = row.executionLocation;
  return receipt;
}

/** Receipt transport is untrusted. Keep only accounting metadata with known shapes. */
export function readExecutionReceipts(value: unknown, expectedOperationId?: string): ConsultExecutionReceipt[] {
  if (!Array.isArray(value)) return [];
  const receipts = new Map<string, ConsultExecutionReceipt>();
  for (const item of value.slice(0, 256)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (!receiptText(row.executionId) || !receiptText(row.parentOperationId) || !receiptText(row.provider) || !receiptText(row.model)
      || (row.role !== "helper" && row.role !== "primary")
      || (row.executionLocation !== "local" && row.executionLocation !== "hosted")
      || typeof row.outcome !== "string" || !["completed", "failed", "unknown", "stopped"].includes(row.outcome)) continue;
    if (expectedOperationId && row.parentOperationId !== expectedOperationId) continue;
    const receipt: ConsultExecutionReceipt = {
      executionId: row.executionId,
      parentOperationId: row.parentOperationId,
      provider: row.provider,
      model: row.model,
      role: row.role,
      executionLocation: row.executionLocation,
      outcome: row.outcome as ConsultExecutionReceipt["outcome"],
      requestedModel: receiptText(row.requestedModel) ? row.requestedModel : null,
      requestId: receiptText(row.requestId) ? row.requestId : null,
      usage: receiptUsage(row.usage),
    };
    const previous = receipts.get(receipt.executionId);
    // A later stale receipt must not erase observed completion.
    if (previous?.outcome === "completed" && receipt.outcome !== "completed") continue;
    receipts.set(receipt.executionId, receipt);
  }
  return [...receipts.values()];
}
