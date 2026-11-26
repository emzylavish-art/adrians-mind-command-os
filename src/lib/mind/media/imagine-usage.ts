import { randomUUID } from "node:crypto";
import { normalizeProviderUsage, providerRequestId } from "../provider-usage.ts";
import type { UsageReceipt } from "../usage-ledger.ts";
import { recordUsageObservation, type UsageRecorder } from "../usage-observation.server.ts";

export function imagineUsageAttempt(input: {
  ownerId?: string; chatId?: string; model: string; stage: "generation" | "edit";
  operationId?: string; record?: UsageRecorder;
}) {
  const operationId = input.operationId ?? `image:${randomUUID()}`;
  const receipt: UsageReceipt = {
    id: `${operationId}/${input.stage}`, operationId, stage: input.stage,
    channel: "image", chatId: input.chatId ?? "", at: new Date().toISOString(),
    provider: "xai", requestedModel: input.model, model: "unknown",
    requestId: null, promptTokens: null, completionTokens: null,
    outcome: "unconfirmed", dispatched: false, providerDispatch: "unknown",
  };
  const record = async (row: UsageReceipt) => {
    if (input.ownerId) await (input.record ?? recordUsageObservation)(input.ownerId, row);
  };
  let dispatchedWrite = Promise.resolve();
  return {
    // A storage outage before transport must not create an unrecorded paid call.
    prepare: () => record({ ...receipt }),
    dispatch() {
      receipt.dispatched = true;
      receipt.providerDispatch = "sent";
      dispatchedWrite = record({ ...receipt }).catch(() => undefined);
    },
    async finish<T extends { ok: boolean }>(result: T, response?: Response, payload?: unknown): Promise<T> {
      await dispatchedWrite;
      const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const usage = normalizeProviderUsage("xai", data);
      await record({
        ...receipt, outcome: !receipt.dispatched ? "rejected_before_dispatch" : result.ok ? "completed" : response && !response.ok ? "failed" : "unconfirmed",
        providerDispatch: receipt.dispatched ? receipt.providerDispatch : "not_sent",
        model: typeof data.model === "string" && data.model.trim() ? data.model : "unknown",
        requestId: providerRequestId(response?.headers, data),
        promptTokens: usage?.prompt_tokens ?? null, completionTokens: usage?.completion_tokens ?? null,
      }).catch(() => undefined);
      return result;
    },
  };
}
