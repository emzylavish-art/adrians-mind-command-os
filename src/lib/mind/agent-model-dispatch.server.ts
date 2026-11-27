import { buildAgentModelBody, readAgentMessage, type AgentMessage, type AgentModel, type AgentRunResult } from "./agent.ts";
import { dispatchContext, reserveDispatchAttempt, runSettledDispatch, settleDispatchResult, type ReserveDispatch, type SettleDispatch } from "./dispatch-attempt.ts";
import { rpcOperationId } from "./rpc-provider-request.server.ts";
import { readProviderReceipt, type ProviderReceipt } from "./provider-usage.ts";
import { resolveXaiInferenceApiKey } from "./xai-adapter.ts";

type GuardResult = { ok: true } | { ok: false; error: string };
type ModelOptions = { model: string; temperature: number; max_tokens: number; reasoning_effort?: "low" | "medium" | "high" | "xhigh" };
export type AgentModelRoundReceipt = {
  step: number;
  operationId: string;
  provider: "xai";
  requestedModel: string;
  reportedModel: string | null;
  state: "not_sent" | "responded" | "failed" | "unknown";
  requestId: string | null;
  usage: ProviderReceipt["usage"];
};
export type AgentDispatchDependencies = {
  fetchImpl?: typeof fetch;
  reserve?: ReserveDispatch;
  settle?: SettleDispatch;
  halt?: (ownerId: string) => Promise<"on" | "off" | "unknown">;
  memory?: (ownerId: string, usedSavedContext: boolean) => Promise<GuardResult>;
  catalogue?: (ownerId: string, model: string, requirements: { images: number; outputTokens: number }) => Promise<GuardResult>;
  resolveKey?: () => { ok: true; key: string } | { ok: false; error: string };
};

export type BudgetedAgentResult = AgentRunResult & {
  operationId: string;
  modelRounds: AgentModelRoundReceipt[];
  dispatched?: false;
  approvalId?: string;
  retryable?: false;
};

/** One fixed route, one immutable request per round, and one task budget for the entire run. */
export function createBudgetedAgentModel(input: {
  ownerId: string;
  apiKey: string;
  signal: AbortSignal;
  options: ModelOptions;
  operationId?: unknown;
  taskId?: unknown;
  projectId?: unknown;
}, deps: AgentDispatchDependencies = {}): { model: AgentModel; operationId: string; finish: (result: AgentRunResult) => BudgetedAgentResult } {
  const operationId = rpcOperationId(input.operationId, "agent");
  const modelRounds: AgentModelRoundReceipt[] = [];
  let dispatches = 0;
  let failure: { error: string; approvalId?: string; retryable: boolean } | null = null;
  const readKey = deps.resolveKey ?? (() => resolveXaiInferenceApiKey(process.env));

  const guard = async (messages: AgentMessage[], signal: AbortSignal): Promise<GuardResult> => {
    if (signal.aborted) return { ok: false, error: "The agent was stopped before the next model request." };
    try {
      const halted = await (deps.halt ?? (await import("./halt.server.ts")).readHaltState)(input.ownerId);
      if (halted !== "off") return { ok: false, error: halted === "on" ? "Emergency stop is on. No new model action can run." : "The current emergency-stop state is unavailable. No new model action can run." };
      const usedSavedContext = messages.some(message => message.role === "tool" && ["search_notes", "list_projects", "list_chats"].includes(message.name));
      const memory = await (deps.memory ?? (await import("./memory/policy.server.ts")).assertOwnerMemoryDispatch)(input.ownerId, usedSavedContext);
      if (!memory.ok) return memory;
      const images = messages.reduce((count, message) => count + (Array.isArray(message.content) ? message.content.filter(part => part.type === "image_url").length : 0), 0);
      const requirements = { images, outputTokens: input.options.max_tokens };
      const catalogue = deps.catalogue
        ? await deps.catalogue(input.ownerId, input.options.model, requirements)
        : await (await import("./environment-model-catalog.server.ts")).validateEnvironmentModel(input.ownerId, "grok", input.options.model, requirements);
      if (!catalogue.ok) return catalogue;
      const keyed = readKey();
      if (!keyed.ok) return { ok: false, error: keyed.error };
      if (keyed.key !== input.apiKey) return { ok: false, error: "The configured provider credential changed during this agent attempt. Start a new reviewed run; nothing was substituted." };
      return signal.aborted ? { ok: false, error: "The agent was stopped before the next model request." } : { ok: true };
    } catch {
      return { ok: false, error: "Current stop, privacy or model-catalogue policy could not be checked. No new model request was sent." };
    }
  };

  const model: AgentModel = async ({ messages, signal }) => {
    const linked = AbortSignal.any([input.signal, signal]);
    const step = modelRounds.length + 1;
    const body = buildAgentModelBody(messages, input.options);
    const context = dispatchContext({ operationId, taskId: input.taskId ?? operationId, projectId: input.projectId, provider: "xai", model: input.options.model, stage: `agent-model-${step}`, args: body, textOnly: false });
    const receipt: AgentModelRoundReceipt = { step, operationId: context.operationId, provider: "xai", requestedModel: input.options.model, reportedModel: null, state: "not_sent", requestId: null, usage: null };
    modelRounds.push(receipt);
    const refuse = (error: string, retryable = true, approvalId?: string): never => {
      failure = { error, retryable, ...(approvalId ? { approvalId } : {}) };
      throw new Error(error);
    };
    const initial = await guard(messages, linked);
    if (!initial.ok) return refuse(initial.error);
    let reservation;
    try { reservation = await reserveDispatchAttempt(input.ownerId, context, deps.reserve); }
    catch { return refuse("The model budget could not be reserved. No model request was sent."); }
    if (!reservation.ok) return refuse(reservation.error, true, reservation.approvalId);

    // Reservation/approval waits must not permit a newly halted or private context to dispatch.
    const current = await guard(messages, linked);
    if (!current.ok) {
      await settleDispatchResult(input.ownerId, reservation.reservationId, { ok: false, dispatched: false }, deps.settle);
      return refuse(current.error, !reservation.reservationId);
    }
    try {
      const result = await runSettledDispatch(input.ownerId, reservation.reservationId, async () => {
        dispatches++;
        receipt.state = "unknown";
        const response = await (deps.fetchImpl ?? fetch)("https://api.x.ai/v1/chat/completions", {
          method: "POST", signal: linked, redirect: "error",
          headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify(body),
        });
        receipt.requestId = readProviderReceipt("openai", null, response.headers).requestId;
        if (!response.ok) { receipt.state = "failed"; throw new Error(`The agent model request failed (HTTP ${response.status}). No substitute model was called.`); }
        const payload: unknown = await response.json();
        const usage = readProviderReceipt("openai", payload, response.headers);
        receipt.requestId = usage.requestId;
        receipt.usage = usage.usage;
        const reported = payload && typeof payload === "object" ? (payload as { model?: unknown }).model : null;
        receipt.reportedModel = typeof reported === "string" && reported.length <= 200 && !/\p{Cc}/u.test(reported) ? reported : null;
        const answer = readAgentMessage(payload);
        if (!answer.text.trim() && !answer.toolCalls.length) throw new Error("The model returned no usable message. Nothing was marked finished.");
        receipt.state = "responded";
        // xAI's token receipt is not a verified USD receipt; the full reservation remains held.
        return { ok: true, ...answer, requestId: receipt.requestId };
      }, deps.settle);
      return { text: result.text, toolCalls: result.toolCalls };
    } catch {
      failure = { error: linked.aborted ? "Stopped. The last model request may have been sent; it cannot be replayed automatically." : receipt.state === "failed" ? "The agent model request failed. No substitute model was called; any earlier tool results remain in the activity log." : "The model response could not be confirmed. Nothing was marked finished; the request cannot be replayed automatically.", retryable: false };
      throw new Error(failure.error);
    }
  };

  return {
    model,
    operationId,
    finish: result => ({
      ...result,
      ...(!result.ok && failure ? { error: failure.error } : {}),
      operationId,
      modelRounds: modelRounds.map(receipt => ({ ...receipt, usage: receipt.usage ? { ...receipt.usage } : null })),
      ...(!dispatches ? { dispatched: false as const } : {}),
      ...(!result.ok && !dispatches && failure?.approvalId ? { approvalId: failure.approvalId } : {}),
      ...(!result.ok && (dispatches > 0 || failure?.retryable === false) ? { retryable: false as const } : {}),
    }),
  };
}
