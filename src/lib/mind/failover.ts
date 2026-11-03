/**
 * Provider failover — truthful end to end.
 *
 * - Off (default): a failed provider surfaces its error; nothing is substituted.
 * - On: when the primary provider fails BEFORE any reply text streamed, the turn is
 *   retried once on another server-configured provider through the real request path.
 *   The answer is labeled with the provider/model that actually answered.
 * - Aborted/stopped turns never fail over.
 * - Error strings are scrubbed of keys, bearer tokens and raw provider URLs.
 *
 * Model-agnostic: provider ids/models come from provider-call's catalog, not the UI.
 */
import { callConfiguredProvider, toTextOnlyMessages, type AssembledMessage, type ProviderName } from "./provider-call.ts";

export type FallbackId = Exclude<ProviderName, "grok">;
export const PROVIDER_IDS: readonly ProviderName[] = ["grok", "openai", "anthropic", "gemini", "openrouter"];
const FALLBACK_ORDER: readonly FallbackId[] = ["openai", "anthropic", "gemini", "openrouter"];
const KEY_ENV: Record<FallbackId, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};
export const FALLBACK_MODEL: Record<FallbackId, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-5",
  gemini: "gemini-2.0-flash",
  openrouter: "openrouter/auto",
};
export const PROVIDER_LABEL: Record<ProviderName, string> = {
  grok: "xAI",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

export const FAILOVER_STORAGE_KEY = "amcos.failover.v2";
export type FailoverPolicy = "on" | "off";

/** Only a literal JSON `true` turns failover on. Strings, 1, objects → off. */
export function parseFailoverField(value: unknown): boolean {
  return value === true;
}

/** Stored preference: only the exact string "on" enables. Legacy v1 values are ignored. */
export function readFailoverPolicy(raw: unknown): FailoverPolicy {
  return raw === "on" ? "on" : "off";
}

export function isProviderId(value: unknown): value is ProviderName {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** First configured provider that is not the primary (and not already tried). */
export function pickFallbackProvider(
  primary: ProviderName,
  env: Record<string, string | undefined>,
  exclude: readonly string[] = [],
): { id: FallbackId; model: string; key: string } | null {
  for (const id of FALLBACK_ORDER) {
    if (id === primary || exclude.includes(id)) continue;
    const key = env[KEY_ENV[id]];
    if (typeof key === "string" && key.trim()) return { id, model: FALLBACK_MODEL[id], key: key.trim() };
  }
  return null;
}

const KEY_LIKE = /\b(?:sk|xai|pk|rk|sess|key)-[A-Za-z0-9_\-]{6,}|\bAIza[0-9A-Za-z_\-]{10,}|\bBearer\s+[A-Za-z0-9._\-]+/gi;
const URL_LIKE = /\b(?:https?|wss?):\/\/[^\s"'<>)]+/gi;
const HOST_LIKE = /\b(?:api\.x\.ai|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|openrouter\.ai)\S*/gi;

/** Scrub keys, bearer tokens and provider URLs from an error before it reaches the browser. */
export function sanitizeProviderError(message: unknown, secrets: readonly (string | undefined)[] = []): string {
  let text = typeof message === "string" ? message : "";
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) text = text.split(secret).join("[redacted]");
  }
  text = text.replace(URL_LIKE, "[provider endpoint]").replace(HOST_LIKE, "[provider endpoint]").replace(KEY_LIKE, "[redacted]");
  text = text.replace(/\s+/g, " ").trim().slice(0, 300);
  return text || "The provider failed.";
}

/** Pull reply text out of a provider's JSON body. Never return raw JSON as a reply. */
export function extractProviderText(id: FallbackId, raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object") return "";
  const body = parsed as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (id === "openai" || id === "openrouter") {
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const first = choices[0] as { message?: { content?: unknown } } | undefined;
    return str(first?.message?.content).trim();
  }
  if (id === "anthropic") {
    const content = Array.isArray(body.content) ? body.content : [];
    return content
      .map((part) => (part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? str((part as { text?: unknown }).text) : ""))
      .join("")
      .trim();
  }
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const parts = (candidates[0] as { content?: { parts?: unknown } } | undefined)?.content?.parts;
  return (Array.isArray(parts) ? parts : []).map((p) => str((p as { text?: unknown } | null)?.text)).join("").trim();
}

export type FallbackOutcome =
  | { ok: true; text: string; provider: FallbackId; model: string; failedOverFrom: ProviderName; failoverReason: string }
  | { ok: false; error: string };

type FetchLike = Parameters<typeof callConfiguredProvider>[0]["fetch"];

/**
 * Retry a failed primary on the next configured provider. Called only by the server
 * request path, only when the client opted in, only before any primary text streamed.
 */
export async function runFallback(input: {
  primary: ProviderName;
  primaryError: string;
  /**
   * The exact messages the primary was sent (assembleTurn output: system/persona prompt,
   * memory notes, history, current turn). Preferred — the fallback gets the same context.
   */
  messages?: readonly AssembledMessage[];
  /** Legacy: latest user text only. Used only when `messages` is absent. */
  prompt?: string;
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  signal?: AbortSignal;
  exclude?: readonly string[];
  /** Extra secrets (e.g. the primary key) to scrub from any message. */
  secrets?: readonly (string | undefined)[];
}): Promise<FallbackOutcome> {
  const secrets = Object.values(KEY_ENV)
    .map((name) => input.env[name])
    .concat(input.env.XAI_API_KEY, ...(input.secrets ?? []));
  const reason = sanitizeProviderError(input.primaryError, secrets);
  const primaryLabel = PROVIDER_LABEL[input.primary];
  if (input.signal?.aborted) return { ok: false, error: reason };
  const pick = pickFallbackProvider(input.primary, input.env, input.exclude ?? []);
  if (!pick) {
    return { ok: false, error: `${reason} Failover is on, but no other provider is configured on the server. Nothing was substituted.` };
  }
  const messages: readonly AssembledMessage[] = Array.isArray(input.messages)
    ? input.messages
    : [{ role: "user", content: typeof input.prompt === "string" ? input.prompt.trim() : "" }];
  // The fallback is text-only: a current turn that carries images never fails over
  // (it would answer as if it had seen them). Prior-turn images become text stubs.
  const current = messages[messages.length - 1];
  if (current && Array.isArray(current.content) && current.content.some((p) => p && typeof p === "object" && (p as { type?: unknown }).type === "image_url")) {
    return { ok: false, error: `${reason} This turn has images and the fallback is text-only; nothing was substituted.` };
  }
  const flat = toTextOnlyMessages(messages);
  const last = flat[flat.length - 1];
  if (!last || last.role !== "user" || !last.content.trim() || current?.role !== "user") {
    return { ok: false, error: `${reason} Failover needs text to resend; nothing was substituted.` };
  }
  let called: Awaited<ReturnType<typeof callConfiguredProvider>>;
  try {
    called = await callConfiguredProvider({ id: pick.id, key: pick.key, messages, fetch: input.fetch });
  } catch {
    called = { ok: false, text: "", error: `${pick.id} could not be reached.` };
  }
  if (input.signal?.aborted) return { ok: false, error: reason };
  const text = called.ok ? extractProviderText(pick.id, called.text) : "";
  if (!called.ok || !text) {
    const why = sanitizeProviderError(called.ok ? `${pick.id} returned an empty reply.` : called.error, secrets);
    return {
      ok: false,
      error: `${reason} Failover to ${PROVIDER_LABEL[pick.id]} also failed: ${why} Nothing was saved as a success.`,
    };
  }
  return { ok: true, text, provider: pick.id, model: pick.model, failedOverFrom: input.primary, failoverReason: `${primaryLabel} failed: ${reason}` };
}

/** Client: one-line notice naming who ACTUALLY answered (from the server's done event). */
export function describeAnswer(result: { model?: unknown; provider?: unknown; failedOverFrom?: unknown; failoverReason?: unknown }): string {
  const model = typeof result.model === "string" && result.model.trim() ? result.model.trim().slice(0, 120) : "an unreported model";
  const provider = isProviderId(result.provider) ? PROVIDER_LABEL[result.provider] : null;
  const who = provider ? `${provider} ${model}` : model;
  if (isProviderId(result.failedOverFrom) && result.failedOverFrom !== result.provider) {
    return `Failover: ${PROVIDER_LABEL[result.failedOverFrom]} failed, so ${who} answered.`;
  }
  return `Answered by ${who}.`;
}
