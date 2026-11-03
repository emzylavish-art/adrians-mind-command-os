/** Minimal xAI chat adapter. Never fabricates a model reply. Never logs key values. */

import { existsSync, readFileSync } from "node:fs";

export const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
export const XAI_MODELS_URL = "https://api.x.ai/v1/models";
export const DEFAULT_XAI_MODEL = "grok-4.5";

/** Box-local secrets file (gitignored / outside the repo). Same pattern as voice. */
export const XAI_INFERENCE_SECRETS_PATH = "/home/box/.secrets/xai_inference.env";

/** Cap for 429 retries (total attempts = 1 + this). */
export const XAI_RATE_LIMIT_MAX_RETRIES = 2;
/** Cap sleep between 429 retries (ms). */
export const XAI_RATE_LIMIT_MAX_BACKOFF_MS = 2_000;
/** Default sleep when 429 has no Retry-After (ms). */
export const XAI_RATE_LIMIT_DEFAULT_BACKOFF_MS = 250;

export type XaiUnavailableReason =
  | "missing_key"
  | "malformed_key"
  | "misconfigured_management_key"
  | "invalid_key"
  | "rate_limited"
  | "api_error"
  | "empty_reply"
  | "unreachable";

export type XaiUnavailable = {
  ok: false;
  state: "unavailable";
  reason: XaiUnavailableReason;
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

function unavailable(
  reason: XaiUnavailableReason,
  error: string,
  extra: Partial<Pick<XaiUnavailable, "status" | "requestId" | "latencyMs" | "model">> = {},
): XaiUnavailable {
  return {
    ok: false,
    state: "unavailable",
    reason,
    error,
    status: extra.status ?? null,
    requestId: extra.requestId ?? null,
    latencyMs: extra.latencyMs ?? 0,
    text: "",
    model: extra.model ?? null,
    usage: null,
  };
}

function missingKey(): XaiUnavailable {
  return unavailable(
    "missing_key",
    "XAI_API_KEY is missing. Grok is unavailable. Nothing was sent and nothing was persisted as a model reply.",
  );
}

function malformedKey(): XaiUnavailable {
  return unavailable(
    "malformed_key",
    "XAI_API_KEY is malformed. Grok is unavailable. Nothing was sent and nothing was persisted as a model reply.",
  );
}

function managementKeyMisconfigured(): XaiUnavailable {
  return unavailable(
    "misconfigured_management_key",
    "misconfigured: management key. XAI_API_KEY matches XAI_MANAGEMENT_KEY and cannot be used for inference. Nothing was sent and nothing was persisted as a model reply.",
  );
}

/**
 * Strip any accidental key material from error text before returning/logging.
 * Compares by equality only; never echoes the key.
 */
export function redactSecretsFromText(
  text: string,
  secrets: Array<string | undefined | null>,
): string {
  let out = text;
  for (const secret of secrets) {
    const value = typeof secret === "string" ? secret.trim() : "";
    if (value.length < 8) continue;
    if (out.includes(value)) out = out.split(value).join("[redacted]");
  }
  return out;
}

/**
 * Shape check for an inference key. Rejects empty, whitespace-only (after trim),
 * wrong prefix, truncated, non-ASCII, and header-injection characters.
 * Padded whitespace is trimmed before the check.
 */
export function validateXaiInferenceKeyShape(raw: string): { ok: true; key: string } | { ok: false; reason: "missing_key" | "malformed_key" } {
  if (raw == null) return { ok: false, reason: "missing_key" };
  if (typeof raw !== "string") return { ok: false, reason: "malformed_key" };
  const key = raw.trim();
  if (!key) return { ok: false, reason: "missing_key" };
  // Header injection / control characters (including embedded CR/LF/TAB).
  if (/[\r\n\t\x00-\x1f\x7f]/.test(key)) return { ok: false, reason: "malformed_key" };
  // Non-ASCII.
  if (/[^\x20-\x7e]/.test(key)) return { ok: false, reason: "malformed_key" };
  // xAI inference keys are `xai-` + URL-safe token; reject wrong prefix and truncated forms.
  if (!key.startsWith("xai-")) return { ok: false, reason: "malformed_key" };
  const body = key.slice(4);
  // Truncated: require a non-trivial body (live inference keys are ~80+ chars total).
  if (body.length < 20) return { ok: false, reason: "malformed_key" };
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return { ok: false, reason: "malformed_key" };
  return { ok: true, key };
}

/** True when the candidate chat key is byte-identical to the management key. Never logs values. */
export function isManagementKeyAsInference(key: string, env: Record<string, string | undefined> = process.env): boolean {
  const candidate = key.trim();
  const management = env.XAI_MANAGEMENT_KEY?.trim() ?? "";
  return Boolean(candidate && management && candidate === management);
}

/** Read `export XAI_API_KEY=...` or `XAI_API_KEY=...` from the box secrets file. */
export function readXaiInferenceSecretsFile(path: string = XAI_INFERENCE_SECRETS_PATH): string | undefined {
  try {
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
  } catch {
    // Unreadable / permission / IO — treat as absent; never invent a key.
    return undefined;
  }
}

/**
 * Load the box inference secrets file into `env` when present (authoritative override).
 * Returns whether a non-empty XAI_API_KEY is set afterward. Never prints the value.
 */
export function applyXaiInferenceSecrets(env: Record<string, string | undefined> = process.env, path: string = XAI_INFERENCE_SECRETS_PATH): boolean {
  const fromFile = readXaiInferenceSecretsFile(path);
  if (fromFile) {
    env.XAI_API_KEY = fromFile;
    return true;
  }
  return Boolean(env.XAI_API_KEY?.trim());
}

/**
 * Validate the current `env.XAI_API_KEY` for inference use.
 * Refuses a key that equals `XAI_MANAGEMENT_KEY`. Does not load the secrets file by itself.
 */
export function readXaiApiKey(env: Record<string, string | undefined> = process.env): { ok: true; key: string } | XaiUnavailable {
  const raw = env.XAI_API_KEY ?? "";
  if (!raw.trim()) return missingKey();
  const shaped = validateXaiInferenceKeyShape(raw);
  if (!shaped.ok) {
    return shaped.reason === "missing_key" ? missingKey() : malformedKey();
  }
  if (isManagementKeyAsInference(shaped.key, env)) return managementKeyMisconfigured();
  return { ok: true, key: shaped.key };
}

/**
 * Canonical resolver for every typed-chat / agent / models path:
 * secrets file overrides process env, then management-key equality is refused.
 */
export function resolveXaiInferenceApiKey(
  env: Record<string, string | undefined> = process.env,
  path: string = XAI_INFERENCE_SECRETS_PATH,
): { ok: true; key: string } | XaiUnavailable {
  applyXaiInferenceSecrets(env, path);
  return readXaiApiKey(env);
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Parse Retry-After header (seconds or HTTP-date) into a bounded delay in ms. */
export function parseRetryAfterMs(
  header: string | null,
  nowMs: number = Date.now(),
  maxMs: number = XAI_RATE_LIMIT_MAX_BACKOFF_MS,
  fallbackMs: number = XAI_RATE_LIMIT_DEFAULT_BACKOFF_MS,
): number {
  if (!header) return Math.min(fallbackMs, maxMs);
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return Math.min(fallbackMs, maxMs);
    return Math.min(Math.round(seconds * 1000), maxMs);
  }
  const when = Date.parse(trimmed);
  if (!Number.isFinite(when)) return Math.min(fallbackMs, maxMs);
  const delta = when - nowMs;
  if (delta <= 0) return Math.min(fallbackMs, maxMs);
  return Math.min(delta, maxMs);
}

function looksLikeInvalidKeyBody(status: number, bodyText: string): boolean {
  if (status === 401) return true;
  if (status !== 400) return false;
  const lower = bodyText.toLowerCase();
  return (
    lower.includes("incorrect api key") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes('"code":"invalid') ||
    lower.includes("expired") ||
    lower.includes("authentication")
  );
}

async function readBodySafe(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export async function listXaiModels(input: {
  env?: Record<string, string | undefined>;
  secretsPath?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  skipSecretsFile?: boolean;
}): Promise<{ ok: true; ids: string[] } | XaiUnavailable> {
  const env = input.env ?? process.env;
  const keyed = input.skipSecretsFile ? readXaiApiKey(env) : resolveXaiInferenceApiKey(env, input.secretsPath ?? XAI_INFERENCE_SECRETS_PATH);
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
    return unavailable("unreachable", "xAI models could not be reached. Nothing was sent.", {
      latencyMs: Date.now() - started,
    });
  }
  if (!res.ok) {
    const bodyText = await readBodySafe(res);
    if (looksLikeInvalidKeyBody(res.status, bodyText)) {
      return unavailable("invalid_key", "xAI rejected the API key. Nothing was sent and nothing was persisted as a model reply.", {
        status: res.status,
        requestId: res.headers.get("x-request-id"),
        latencyMs: Date.now() - started,
      });
    }
    return unavailable("api_error", redactSecretsFromText(`xAI models returned ${res.status}.`, [keyed.key, env.XAI_MANAGEMENT_KEY]), {
      status: res.status,
      requestId: res.headers.get("x-request-id"),
      latencyMs: Date.now() - started,
    });
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
  secretsPath?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** When true, skip secrets-file load (tests that pass an explicit env only). */
  skipSecretsFile?: boolean;
  /** Inject sleep for 429 backoff tests. */
  sleepFn?: SleepFn;
  /** Override max 429 retries (default XAI_RATE_LIMIT_MAX_RETRIES). */
  maxRetries?: number;
}): Promise<XaiResult> {
  const env = input.env ?? process.env;
  const keyed = input.skipSecretsFile ? readXaiApiKey(env) : resolveXaiInferenceApiKey(env, input.secretsPath ?? XAI_INFERENCE_SECRETS_PATH);
  if (!keyed.ok) return keyed;
  const model = input.model ?? DEFAULT_XAI_MODEL;
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleepFn = input.sleepFn ?? defaultSleep;
  const maxRetries = input.maxRetries ?? XAI_RATE_LIMIT_MAX_RETRIES;
  const started = Date.now();
  let attempt = 0;

  while (true) {
    attempt += 1;
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
    } catch (err) {
      const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
      const message = err instanceof Error ? err.message : "";
      const isTimeout = name === "TimeoutError" || name === "AbortError" || /timeout|aborted/i.test(message);
      return unavailable(
        "unreachable",
        isTimeout
          ? "xAI request timed out. Nothing was persisted as a model reply."
          : "xAI could not be reached. Nothing was persisted as a model reply.",
        { latencyMs: Date.now() - started, model },
      );
    }

    const latencyMs = Date.now() - started;
    const requestId = res.headers.get("x-request-id");

    if (res.status === 429) {
      const retriesUsed = attempt - 1;
      if (retriesUsed < maxRetries) {
        const delay = parseRetryAfterMs(res.headers.get("retry-after"));
        await sleepFn(delay);
        continue;
      }
      return unavailable("rate_limited", "xAI rate limited the request. Nothing was persisted as a model reply.", {
        status: 429,
        requestId,
        latencyMs,
        model,
      });
    }

    if (!res.ok) {
      const bodyText = await readBodySafe(res);
      // Consume/redact body so callers never see key material even if upstream echoed it.
      void redactSecretsFromText(bodyText, [keyed.key, env.XAI_MANAGEMENT_KEY]);
      if (looksLikeInvalidKeyBody(res.status, bodyText)) {
        return unavailable("invalid_key", "xAI rejected the API key. Nothing was persisted as a model reply.", {
          status: res.status,
          requestId,
          latencyMs,
          model,
        });
      }
      return unavailable("api_error", `xAI returned ${res.status}. Nothing was persisted as a model reply.`, {
        status: res.status,
        requestId,
        latencyMs,
        model,
      });
    }

    let payload: {
      choices?: { message?: { content?: string } }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      return unavailable("empty_reply", "xAI returned an unreadable body. Nothing was persisted as a model reply.", {
        status: res.status,
        requestId,
        latencyMs,
        model,
      });
    }
    const text = payload.choices?.[0]?.message?.content ?? "";
    if (typeof text !== "string" || !text.trim()) {
      return unavailable("empty_reply", "xAI returned an empty reply. Nothing was persisted as a model reply.", {
        status: res.status,
        requestId,
        latencyMs,
        model,
      });
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
}
