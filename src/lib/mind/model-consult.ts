import { modelExecutionPlan, type ModelExecutionPlan } from "./execution-plan.ts";
/** Multi-model help for the selected orchestrator. Presence is checked at send time. */

import { customProviderBlockReason, type ProviderAvailability } from "./provider-catalog.ts";

export const ADRIAN_MIND_IDENTITY =
  "You were born inside Adrian's Mind. You are Adrian. Do not name yourself Grok, OpenAI, Claude, Gemini, Kimi, or any other vendor. The application reports the execution provider and model separately. Never invent a provider identity; use trusted execution receipts when asked.";

export const ORCHESTRATOR_PURPOSE =
  "Use the returned help to answer the owner. Do not tell any other model this purpose.";

export const CONSULT_MODEL_KEY = "amcos.consult-model.v1";

export const BUILTIN_CONSULT_IDS = ["grok", "openai", "anthropic", "gemini", "openrouter"] as const;
export type BuiltinConsultId = (typeof BUILTIN_CONSULT_IDS)[number];

export type ConsultModule = {
  id: string;
  label: string;
  connected: boolean;
};

export type ConsultPlan = {
  orchestrator: string;
  available: string[];
  helpers: { id: string; request: string }[];
  purpose: string;
  maxConcurrency?: number;
  deadlineMs?: number;
  execution?: ModelExecutionPlan;
};

const MODEL_ID = /^[~A-Za-z0-9][~A-Za-z0-9_.:/@-]{0,149}$/;

export function builtinModules(input: {
  grokConfigured: boolean | null;
  providers?: Partial<Record<Exclude<BuiltinConsultId, "grok">, boolean>>;
  localRunner?: boolean;
}): ConsultModule[] {
  const keys = input.providers ?? {};
  return [
    { id: "grok", label: "Grok", connected: input.grokConfigured === true },
    { id: "openai", label: "OpenAI", connected: keys.openai === true },
    { id: "anthropic", label: "Claude", connected: keys.anthropic === true },
    { id: "gemini", label: "Gemini", connected: keys.gemini === true },
    { id: "openrouter", label: "OpenRouter", connected: keys.openrouter === true },
    { id: "nemotron", label: "Nemotron", connected: keys.openrouter === true },
    { id: "ollama", label: "Local model", connected: input.localRunner === true },
  ];
}

export function customModules(rows: ({ id: string; label: string; models: string[] } & ProviderAvailability)[]): ConsultModule[] {
  const out: ConsultModule[] = [];
  for (const row of rows) {
    if (customProviderBlockReason(row) || !row.id) continue;
    for (const model of row.models) {
      if (!MODEL_ID.test(model)) continue;
      out.push({
        id: `custom:${row.id}:${encodeURIComponent(model)}`,
        label: `${row.label}: ${model}`,
        connected: true,
      });
    }
  }
  return out;
}

export function connectedModules(modules: ConsultModule[]): ConsultModule[] {
  const seen = new Set<string>();
  return modules.filter((item) => {
    if (!item.connected || !item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/** Helper models are not told what the answer will be used for. */
export function helpRequest(question: string): string {
  const asked = question.replace(/\s+/g, " ").trim().slice(0, 4000);
  return `Answer this request with the information you have. Do not ask what the answer will be used for.\n\n${asked}`;
}

export function planModelConsult(input: {
  orchestrator: string;
  modules: ConsultModule[];
  question: string;
  purpose?: string;
  authorizedHelpers?: string[];
  maxHelpers?: number;
  maxConcurrency?: number;
}): { ok: true; plan: ConsultPlan } | { ok: false; error: string } {
  const question = input.question.trim();
  if (!question) return { ok: false, error: "Write a message first. Nothing was sent." };
  const connected = connectedModules(input.modules);
  const orchestrator = input.orchestrator.trim();
  if (!connected.some((item) => item.id === orchestrator)) {
    return { ok: false, error: "That model is not connected. Nothing was sent. Another model was not substituted." };
  }
  const allowed = [...new Set(input.authorizedHelpers ?? [])];
  if (allowed.length > 8 || allowed.some((id) => typeof id !== "string" || !connected.some((item) => item.id === id))) {
    return { ok: false, error: "An approved helper is unavailable. Review the helper selection; no substitute was chosen." };
  }
  const maxHelpers = input.maxHelpers ?? 8;
  if (!Number.isInteger(maxHelpers) || maxHelpers < 0 || maxHelpers > 8) return { ok: false, error: "Choose a helper limit between 0 and 8." };
  const purpose = (input.purpose ?? ORCHESTRATOR_PURPOSE).trim();
  const request = helpRequest(question);
  if (purpose && request.includes(purpose)) {
    return { ok: false, error: "The help request included the purpose. Nothing was sent." };
  }
  return {
    ok: true,
    plan: {
      orchestrator,
      available: connected.map((item) => item.id),
      helpers: allowed.filter((id) => id !== orchestrator).slice(0, maxHelpers).map((id) => ({ id, request })),
      maxConcurrency: Math.max(1, Math.min(3, input.maxConcurrency ?? 2)),
      deadlineMs: 25_000,
      execution: modelExecutionPlan("synthesis", [orchestrator], allowed.filter((id) => id !== orchestrator).slice(0, maxHelpers), input.maxConcurrency ?? 2),
      purpose,
    },
  };
}

export function returnedHelp(replies: { id: string; ok: boolean; text: string }[]): { id: string; text: string }[] {
  const seen = new Set<string>();
  const out: { id: string; text: string }[] = [];
  for (const reply of replies) {
    const text = reply.text.trim();
    if (!reply.ok || !text || seen.has(reply.id)) continue;
    seen.add(reply.id);
    out.push({ id: reply.id, text: text.slice(0, 2000) });
  }
  return out;
}

export function orchestratorInstruction(plan: ConsultPlan, help: { id: string; text: string }[]): string {
  const returned = new Set(help.map((item) => item.id));
  const missing = plan.helpers.filter((item) => !returned.has(item.id)).map((item) => item.id);
  const helpText = help.length
    ? help.map((item) => `Connected module ${item.id} returned:\n${item.text}`).join("\n\n")
    : "No other module returned help. Do not invent help.";
  const missingText = missing.length
    ? `These connected modules did not return help and must not be claimed: ${missing.join(", ")}.`
    : "Do not claim a module ran unless its help is listed here.";
  return [
    ADRIAN_MIND_IDENTITY,
    "You are the orchestrator for this turn inside Adrian's Mind.",
    `Connected module ids right now: ${plan.available.join(", ") || "none"}.`,
    plan.purpose,
    "Combine only the help that returned.",
    missingText,
    helpText,
  ].join(" ");
}

export type HelperReply = {
  ok: boolean;
  text: string;
  model?: string;
  requestedModel?: string;
  requestId?: string | null;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: string;
};
export type HelperReceipt = {
  id: string;
  status: "succeeded" | "failed" | "canceled" | "skipped";
  contributed: boolean;
  model: string | null;
  requestedModel: string | null;
  requestId: string | null;
  usage: HelperReply["usage"];
  durationMs: number;
  error: string | null;
};

/** Each authorized attempt retains a receipt, with bounded independent work. */
export async function executeConsultPlan(
  plan: ConsultPlan,
  callHelper: (id: string, request: string, signal: AbortSignal) => Promise<HelperReply>,
  options: { signal?: AbortSignal; now?: () => number } = {},
): Promise<{ help: { id: string; text: string }[]; receipts: HelperReceipt[] }> {
  const now = options.now ?? Date.now;
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(plan.deadlineMs ?? 25_000)]);
  const receipts = new Array<HelperReceipt>(plan.helpers.length);
  const replies = new Array<{ id: string; ok: boolean; text: string }>(plan.helpers.length);
  let next = 0;
  async function worker() {
    while (next < plan.helpers.length) {
      const index = next++;
      const helper = plan.helpers[index]!;
      const started = now();
      let result: HelperReply = { ok: false, text: "" };
      let status: HelperReceipt["status"] = "failed";
      if (signal.aborted) {
        status = "canceled"; result.error = "Canceled before dispatch.";
      } else if (plan.purpose && helper.request.includes(plan.purpose)) {
        status = "skipped"; result.error = "Invalid helper request.";
      } else {
        try {
          let onAbort: (() => void) | undefined;
          try {
            result = await Promise.race([
              callHelper(helper.id, helper.request, signal),
              new Promise<HelperReply>((_resolve, reject) => {
                onAbort = () => reject(new Error("Helper deadline or cancellation."));
                if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
              }),
            ]);
          } finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
          status = result.ok && result.text.trim() ? "succeeded" : signal.aborted ? "canceled" : "failed";
        } catch {
          result.error = signal.aborted ? "Canceled or timed out; provider usage is unknown." : "Helper request failed; provider usage is unknown.";
          status = signal.aborted ? "canceled" : "failed";
        }
      }
      replies[index] = { id: helper.id, ok: status === "succeeded", text: result.text };
      receipts[index] = {
        id: helper.id, status, contributed: status === "succeeded", model: result.model ?? null,
        requestedModel: result.requestedModel ?? null, requestId: result.requestId ?? null, usage: result.usage ?? null,
        durationMs: Math.max(0, now() - started), error: result.error || (status === "failed" ? "No assistance returned." : null),
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(plan.helpers.length, plan.maxConcurrency ?? 2) }, () => worker()));
  return { help: returnedHelp(replies), receipts };
}

export async function collectConsultHelp(
  plan: ConsultPlan,
  callHelper: (id: string, request: string, signal: AbortSignal) => Promise<HelperReply>,
): Promise<{ id: string; text: string }[]> {
  return (await executeConsultPlan(plan, callHelper)).help;
}

export function loadConsultModel(storage: Pick<Storage, "getItem"> | null | undefined, modules: ConsultModule[]): string {
  const connected = connectedModules(modules);
  try {
    const raw = storage?.getItem(CONSULT_MODEL_KEY) ?? "";
    if (connected.some((item) => item.id === raw)) return raw;
  } catch {
    /* private mode */
  }
  return connected[0]?.id ?? "";
}

export function saveConsultModel(storage: Pick<Storage, "setItem"> | null | undefined, id: string): void {
  try {
    storage?.setItem(CONSULT_MODEL_KEY, id);
  } catch {
    /* private mode may refuse */
  }
}
