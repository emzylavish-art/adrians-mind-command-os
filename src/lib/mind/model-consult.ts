/** Multi-model help for the selected orchestrator. Presence is checked at send time. */

import { customProviderBlockReason, type ProviderAvailability } from "./provider-catalog.ts";
import type { ProviderReceipt } from "./provider-receipt.ts";

export const ADRIAN_MIND_IDENTITY =
  "You were born inside Adrian's Mind. You are Adrian. Do not name yourself Grok, OpenAI, Claude, Gemini, Kimi, or any other vendor. Do not say which model or API produced the answer. Do not think of yourself as a model outside this platform.";

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
}): { ok: true; plan: ConsultPlan } | { ok: false; error: string } {
  const question = input.question.trim();
  if (!question) return { ok: false, error: "Write a message first. Nothing was sent." };
  const connected = connectedModules(input.modules);
  const orchestrator = input.orchestrator.trim();
  if (!connected.some((item) => item.id === orchestrator)) {
    return { ok: false, error: "That model is not connected. Nothing was sent. Another model was not substituted." };
  }
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
      helpers: connected.filter((item) => item.id !== orchestrator).slice(0, 8).map((item) => ({ id: item.id, request })),
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

export async function collectConsultHelp(
  plan: ConsultPlan,
  callHelper: (id: string, request: string) => Promise<ConsultResult>,
  options: { parentOperationId?: string; onReceipt?: (receipt: ConsultExecutionReceipt) => void | Promise<void> } = {},
): Promise<{ id: string; text: string }[]> {
  const replies: { id: string; ok: boolean; text: string }[] = [];
  const parentOperationId = options.parentOperationId ?? crypto.randomUUID();
  for (const [index, helper] of plan.helpers.entries()) {
    if (helper.request.includes(plan.purpose)) {
      replies.push({ id: helper.id, ok: false, text: "" });
      continue;
    }
    let result: ConsultResult;
    try { result = await callHelper(helper.id, helper.request); }
    catch { result = { ok: false, text: "", dispatched: true, outcome: "unknown" }; }
    replies.push({ id: helper.id, ok: result.ok, text: result.text });
    if (result.dispatched !== false) {
      await options.onReceipt?.({
        executionId: `${parentOperationId}:helper:${index}`,
        parentOperationId,
        role: "helper",
        provider: result.provider ?? helper.id,
        requestedModel: result.requestedModel ?? null,
        model: result.model ?? "model unknown",
        usage: result.usage ?? null,
        requestId: result.requestId ?? null,
        executionLocation: result.executionLocation ?? (helper.id === "ollama" ? "local" : "hosted"),
        outcome: result.ok ? "completed" : result.outcome ?? "failed",
      });
    }
  }
  return returnedHelp(replies);
}

export type ConsultResult = { ok: boolean; text: string; dispatched?: boolean; provider?: string; model?: string; requestedModel?: string;
  outcome?: "failed" | "unknown" | "stopped" } & Partial<ProviderReceipt>;

export type ConsultExecutionReceipt = ProviderReceipt & {
  executionId: string;
  parentOperationId: string;
  role: "helper" | "primary";
  provider: string;
  requestedModel: string | null;
  model: string;
  outcome: "completed" | "failed" | "unknown" | "stopped";
};

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
