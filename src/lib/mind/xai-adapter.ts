/** Minimal xAI chat adapter. Never fabricates a model reply. Never logs key values. */

import { existsSync, readFileSync } from "node:fs";

export const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
export const XAI_MODELS_URL = "https://api.x.ai/v1/models";
export const DEFAULT_XAI_MODEL = "grok-4.5";

/** Box-local secrets file (gitignored / outside the repo). Same pattern as voice. */
export const XAI_INFERENCE_SECRETS_PATH = "/home/box/.secrets/xai_inference.env";

export type XaiUnavailable = {
  ok: false;
  state: "unavailable";
  reason: "missing_key" | "api_error" | "empty_reply" | "unreachable";
  error: string;
  status: number | null;
  requestId: string | null;
  latencyMs: number;
  text: "";
  model: string | null;
  usage: null;
};

export type XaiOk = {
  ok: true;
  state: "ok";
  text: string;
  model: string;
  requestId: string | null;
  latencyMs: number;
  usage: { prompt_tokens: number | null; completion_tokens: number | null } | null;
  status: number;
};

export type XaiResult = XaiOk | XaiUnavailable;

function missingKey(): XaiUnavailable {
  return {
    ok: false,
    state: "unavailable",
    reason: "missing_key",
    error: "XAI_API_KEY is missing. Grok is unavailable. Nothing was sent and nothing was persisted as a model reply.",
    status: null,
    requestId: null,
    latencyMs: 0,
    text: "",
    model: null,
    usage: null,
  };
}

/** Read `export XAI_API_KEY=...` or `XAI_API_KEY=...` from the box secrets file. */
export function readXaiInferenceSecretsFile(path: string = XAI_INFERENCE_SECRETS_PATH): string | undefined {
  if (!existsSync(path)) return undefined;
  const body = readFileSync(path, "utf8");
  for (const line of body.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?XAI_API_KEY=(.*)$/);
    if (!match) continue;
    let value = match[1]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value || undefined;
  }
  return undefined;
}

/**
 * If `XAI_API_KEY` is unset, load it from the box secrets file into `env` (default: process.env).
 * Returns whether a non-empty key is available afterward. Never prints the value.
 */
export function applyXaiInferenceSecrets(env: Record<string, string | undefined> = process.env, path: string = XAI_INFERENCE_SECRETS_PATH): boolean {
  // Box secrets file is authoritative for Mind inference when present (avoids a stale
  // process env key shadowing the minted inference key). Never logs the value.
  const fromFile = readXaiInferenceSecretsFile(path);
  if (fromFile) {
    env.XAI_API_KEY = fromFile;
    return true;
  }
  return Boolean(env.XAI_API_KEY?.trim());
}

export function readXaiApiKey(env: Record<string, string | undefined> = process.env): { ok: true; key: string } | XaiUnavailable {
  const key = env.XAI_API_KEY?.trim() ?? "";
  if (!key) return missingKey();
  return { ok: true, key };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function listXaiModels(input: {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<{ ok: true; ids: string[] } | XaiUnavailable> {
  const keyed = readXaiApiKey(input.env ?? process.env);
  if (!keyed.ok) return keyed;
  const fetchImpl = input.fetchImpl ?? fetch;
  const started = Date.now();
  let res: Response;
  try {
    res = await fetchImpl(XAI_MODELS_URL, {
      method: "GET",
      signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
      headers: { authorization: `Bearer ${keyed.key}`, accept: "application/json" },
    });
  } catch {
    return {
      ok: false,
      state: "unavailable",
      reason: "unreachable",
      error: "xAI models could not be reached. Nothing was sent.",
      status: null,
      requestId: null,
      latencyMs: Date.now() - started,
      text: "",
      model: null,
      usage: null,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      state: "unavailable",
      reason: "api_error",
      error: `xAI models returned ${res.status}.`,
      status: res.status,
      requestId: res.headers.get("x-request-id"),
      latencyMs: Date.now() - started,
      text: "",
      model: null,
      usage: null,
    };
  }
  const payload = (await res.json()) as { data?: { id?: string }[] };
  const ids = Array.isArray(payload.data) ? payload.data.map((row) => row.id).filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  return { ok: true, ids };
}

export async function callXaiChat(input: {
  prompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<XaiResult> {
  const keyed = readXaiApiKey(input.env ?? process.env);
  if (!keyed.ok) return keyed;
  const model = input.model ?? DEFAULT_XAI_MODEL;
  const fetchImpl = input.fetchImpl ?? fetch;
  const started = Date.now();
  let res: Response;
  try {
    res = await fetchImpl(XAI_CHAT_URL, {
      method: "POST",
      signal: AbortSignal.timeout(input.timeoutMs ?? 25_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${keyed.key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: input.prompt }],
        temperature: input.temperature ?? 0,
        max_tokens: input.maxTokens ?? 16,
        stream: false,
      }),
    });
  } catch {
    return {
      ok: false,
      state: "unavailable",
      reason: "unreachable",
      error: "xAI could not be reached. Nothing was persisted as a model reply.",
      status: null,
      requestId: null,
      latencyMs: Date.now() - started,
      text: "",
      model,
      usage: null,
    };
  }
  const latencyMs = Date.now() - started;
  const requestId = res.headers.get("x-request-id");
  if (!res.ok) {
    return {
      ok: false,
      state: "unavailable",
      reason: "api_error",
      error: `xAI returned ${res.status}. Nothing was persisted as a model reply.`,
      status: res.status,
      requestId,
      latencyMs,
      text: "",
      model,
      usage: null,
    };
  }
  let payload: {
    choices?: { message?: { content?: string } }[];
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    return {
      ok: false,
      state: "unavailable",
      reason: "empty_reply",
      error: "xAI returned an unreadable body. Nothing was persisted as a model reply.",
      status: res.status,
      requestId,
      latencyMs,
      text: "",
      model,
      usage: null,
    };
  }
  const text = payload.choices?.[0]?.message?.content ?? "";
  if (typeof text !== "string" || !text.trim()) {
    return {
      ok: false,
      state: "unavailable",
      reason: "empty_reply",
      error: "xAI returned an empty reply. Nothing was persisted as a model reply.",
      status: res.status,
      requestId,
      latencyMs,
      text: "",
      model,
      usage: null,
    };
  }
  return {
    ok: true,
    state: "ok",
    text,
    model: typeof payload.model === "string" ? payload.model : model,
    requestId,
    latencyMs,
    status: res.status,
    usage: payload.usage
      ? {
          prompt_tokens: typeof payload.usage.prompt_tokens === "number" ? payload.usage.prompt_tokens : null,
          completion_tokens: typeof payload.usage.completion_tokens === "number" ? payload.usage.completion_tokens : null,
        }
      : null,
  };
}
