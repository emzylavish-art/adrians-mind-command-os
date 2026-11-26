import { randomUUID } from "node:crypto";
import { providerRequestId, validTokenCount } from "../provider-usage.ts";
import type { UsageReceipt } from "../usage-ledger.ts";

export type VoiceUsageStage = "transcription" | "speech" | "dictation-refinement" | "answer" | "realtime-session";
export type VoiceUsageWriter = (ownerId: string, receipt: UsageReceipt) => Promise<void>;

async function defaultRecord(ownerId: string, receipt: UsageReceipt): Promise<void> {
  const [{ getSql }, { writeUsageReceipt }] = await Promise.all([
    import("../../db.ts"), import("../usage-ledger.server.ts"),
  ]);
  await writeUsageReceipt(await getSql(), ownerId, receipt);
}

function modelName(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9_.:/-]+$/.test(value) ? value : undefined;
}

function requestedModel(body: BodyInit | null | undefined): string | undefined {
  if (body instanceof FormData) return modelName(body.get("model"));
  if (typeof body === "string") {
    try { return modelName((JSON.parse(body) as { model?: unknown }).model); } catch { return undefined; }
  }
  return undefined;
}

/**
 * Wrap the actual transport, including each permitted fallback attempt. Only
 * execution metadata is recorded: never audio, prompts, text, headers or secrets.
 * A failed initial journal prevents that dispatch. A failed final journal must
 * never turn a successful provider response into a retryable transport failure.
 */
export function createVoiceUsageTracker(ownerId: string, deps: {
  record?: VoiceUsageWriter;
  fetchImpl?: typeof fetch;
  operationId?: string;
  now?: () => number;
} = {}) {
  const operationId = deps.operationId ?? `voice-${randomUUID()}`;
  const record = deps.record ?? defaultRecord;
  const transport = deps.fetchImpl ?? fetch;
  let attempt = 0, blocked = false;
  const failure = "The next speech request was not sent because its usage record could not be saved. Try again after storage is available.";
  return {
    operationId,
    get error(): string | null { return blocked ? failure : null; },
    fetch(stage: VoiceUsageStage): typeof fetch {
      return (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (blocked) throw new Error(failure);
        const url = new URL(input instanceof Request ? input.url : String(input));
        const provider = url.hostname === "api.x.ai" ? "xai" : url.hostname === "api.openai.com" ? "openai" : "unreported";
        const identity = `${stage}:${++attempt}:${provider}`;
        const initial: UsageReceipt = {
          id: `${operationId}/${identity}`, operationId, stage: identity, channel: "speak", chatId: "",
          at: new Date(deps.now?.() ?? Date.now()).toISOString(), provider, model: "unknown",
          requestedModel: requestedModel(init?.body), requestId: null,
          promptTokens: null, completionTokens: null, outcome: "unconfirmed", dispatched: false, providerDispatch: "not_sent",
        };
        try { await record(ownerId, initial); }
        catch { blocked = true; throw new Error(failure); }

        let response: Response;
        try { response = await transport(input, init); }
        catch (error) {
          await record(ownerId, { ...initial, dispatched: true, providerDispatch: stage === "realtime-session" ? "unknown" : "sent", outcome: "unconfirmed" }).catch(() => undefined);
          throw error;
        }
        let payload: Record<string, unknown> | undefined;
        // Binary speech and client-secret values must never enter the ledger.
        if (stage !== "speech" && stage !== "realtime-session") {
          try {
            const parsed: unknown = await response.clone().json();
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
          } catch { /* A provider can omit usage; keep the existing response intact. */ }
        }
        const rawUsage = payload?.usage;
        const usage = rawUsage && typeof rawUsage === "object" ? rawUsage as Record<string, unknown> : {};
        await record(ownerId, {
          ...initial, dispatched: true, providerDispatch: stage === "realtime-session" ? "unknown" : "sent",
          // Minting authorization does not prove a realtime call ran or consumed tokens.
          outcome: !response.ok ? "failed" : stage === "realtime-session" ? "unconfirmed" : "completed",
          model: modelName(payload?.model) ?? "unknown",
          requestId: providerRequestId(response.headers, payload),
          promptTokens: validTokenCount(usage.prompt_tokens) ?? validTokenCount(usage.input_tokens) ?? null,
          completionTokens: validTokenCount(usage.completion_tokens) ?? validTokenCount(usage.output_tokens) ?? null,
        }).catch(() => undefined);
        return response;
      }) as typeof fetch;
    },
  };
}
