import type { ChatContent } from "./media/types.ts";
import type { ResolvedModelTier } from "./model-tiers.ts";
import { buildRelayModelBody } from "./relay.ts";
import { readModelPayload, reportedModel } from "./stream.ts";
import { CHAT_TIMEOUT_REPLY } from "./turn-timeouts.ts";
import { readHaltState } from "./halt.server.ts";
import { assertOwnerMemoryDispatch } from "./memory/policy.server.ts";
import { validateEnvironmentModel } from "./environment-model-catalog.server.ts";
import { resolveXaiInferenceApiKey } from "./xai-adapter.ts";
import { rpcDispatchContext, rpcOperationId, runOwnerProviderRequest } from "./rpc-provider-request.server.ts";

export type LegacyPreparedTurn = {
  assembled: { messages: { role: "system" | "user" | "assistant"; content: ChatContent }[]; usedIds: string[] };
  memory: "off" | "on";
  model: string;
  modelTier: ResolvedModelTier;
  userId: string;
  operationId?: unknown;
  taskId?: unknown;
  projectId?: unknown;
  usedSavedMemory?: boolean;
};
export type LegacyTurnDependencies = {
  halt?: typeof readHaltState;
  memory?: typeof assertOwnerMemoryDispatch;
  catalogue?: typeof validateEnvironmentModel;
  credential?: () => { ok: true; key: string } | { ok: false; error: string };
  finance?: Parameters<typeof runOwnerProviderRequest>[3];
  fetchImpl?: typeof fetch;
};

/** Legacy RPC uses the same owner policy as streaming chat; it is not a budget bypass. */
export async function completeLegacyModelReply(prepared: LegacyPreparedTurn, deps: LegacyTurnDependencies = {}) {
  const operationId = rpcOperationId(prepared.operationId, "legacy-chat");
  const refused = (error: string) => ({ ok: false as const, error, operationId, dispatched: false as const });
  const stop = await (deps.halt ?? readHaltState)(prepared.userId);
  if (stop !== "off") return refused(stop === "on" ? "Emergency stop is on. This chat request was not sent." : "Emergency stop status is unavailable. This chat request was not sent.");
  const privacy = await (deps.memory ?? assertOwnerMemoryDispatch)(prepared.userId, prepared.usedSavedMemory === true || prepared.assembled.usedIds.length > 0);
  if (!privacy.ok) return refused(privacy.error);
  const images = prepared.assembled.messages.reduce((count, message) => count + (Array.isArray(message.content) ? message.content.filter(part => part.type === "image_url").length : 0), 0);
  const readiness = await (deps.catalogue ?? validateEnvironmentModel)(prepared.userId, "grok", prepared.model, { images, outputTokens: prepared.modelTier.params.max_tokens });
  if (!readiness.ok) return refused(readiness.error);
  const keyed = (deps.credential ?? (() => resolveXaiInferenceApiKey(process.env)))();
  if (!keyed.ok) return refused(keyed.error);
  const body = buildRelayModelBody(prepared.model, prepared.assembled.messages, {
    temperature: prepared.modelTier.params.temperature,
    max_tokens: prepared.modelTier.params.max_tokens,
    reasoning_effort: prepared.modelTier.params.reasoning_effort,
  });
  const dispatch = rpcDispatchContext({ operationId, taskId: rpcOperationId(prepared.taskId ?? operationId, "legacy-task"),
    projectId: typeof prepared.projectId === "string" && prepared.projectId.trim() ? prepared.projectId.trim() : null,
    provider: "xai", model: prepared.model, textOnly: images === 0 }, body);
  return runOwnerProviderRequest(prepared.userId, dispatch, async () => {
    let response: Response;
    try {
      response = await (deps.fetchImpl ?? fetch)("https://api.x.ai/v1/chat/completions", {
        method: "POST", signal: AbortSignal.timeout(25_000),
        headers: { "content-type": "application/json", authorization: `Bearer ${keyed.key}` }, body: JSON.stringify(body),
      });
    } catch { return { ok: false as const, error: CHAT_TIMEOUT_REPLY }; }
    if (!response.ok) return { ok: false as const, error: `Grok returned ${response.status}. Nothing was saved as a success.` };
    const parsed = readModelPayload(await response.text());
    if (!parsed.text) return { ok: false as const, error: "Grok returned an empty reply.", usage: parsed.usage, requestId: response.headers.get("x-request-id") };
    return { ok: true as const, text: parsed.text, model: reportedModel(parsed.model), modelTier: prepared.modelTier.selected,
      resolvedTier: prepared.modelTier.resolved, tierReason: prepared.modelTier.reason, requestId: response.headers.get("x-request-id"), usage: parsed.usage,
      memory: prepared.memory, usedIds: prepared.assembled.usedIds, memorySaved: false as const, savedMemoryId: null as string | null };
  }, deps.finance);
}
