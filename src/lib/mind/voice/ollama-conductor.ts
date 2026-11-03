import { clampOllamaTranscript } from "./limits.ts";
import { ollamaAllowRemoteFromEnv, resolveSafeOllamaBase } from "./ollama-host.ts";

export type OllamaConductorConfig = {
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** When true, non-loopback hosts are allowed. Defaults from MIND_OLLAMA_ALLOW_REMOTE. */
  allowRemote?: boolean;
  env?: Record<string, string | undefined>;
};

export type OllamaConductorResult =
  | { ok: true; text: string; model: string }
  | { ok: false; error: string; unreachable: boolean };

export const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434";
/** Preferred model name when installed; otherwise resolveOllamaModel picks from /api/tags. */
export const DEFAULT_OLLAMA_MODEL = "llama3.2";
/** Box/dev fallback when tags are empty or unreachable. */
export const FALLBACK_OLLAMA_MODEL = "qwen2.5:0.5b";

/** @deprecated Prefer ollamaUnreachableMessage(base) so the URL is always concrete. */
export const OLLAMA_UNREACHABLE =
  "Orchestrator needs Ollama running locally; not reachable at http://127.0.0.1:11434. Switch Voice mode to Direct, or start Ollama and try again.";

export function ollamaUnreachableMessage(baseUrl: string = DEFAULT_OLLAMA_BASE): string {
  const base = (baseUrl || DEFAULT_OLLAMA_BASE).replace(/\/$/, "");
  return `Orchestrator needs Ollama running locally; not reachable at ${base}. Switch Voice mode to Direct, or start Ollama and try again.`;
}

function resolveBase(config: OllamaConductorConfig) {
  const allowRemote = config.allowRemote ?? ollamaAllowRemoteFromEnv(config.env ?? process.env);
  return resolveSafeOllamaBase(config.baseUrl, { allowRemote, fallback: DEFAULT_OLLAMA_BASE });
}

/**
 * Pick an installed Ollama model. Prefer an explicit config.model, then DEFAULT_OLLAMA_MODEL
 * if listed in /api/tags, then any qwen*, then the first tag, else FALLBACK_OLLAMA_MODEL.
 */
export async function resolveOllamaModel(config: OllamaConductorConfig = {}): Promise<string> {
  const explicit = config.model?.trim();
  if (explicit) return explicit;
  const resolved = resolveBase(config);
  if (!resolved.ok) return FALLBACK_OLLAMA_MODEL;
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = Math.min(config.timeoutMs ?? 3_000, 5_000);
  try {
    const response = await fetchImpl(`${resolved.base}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return FALLBACK_OLLAMA_MODEL;
    const payload = (await response.json()) as { models?: Array<{ name?: string }> };
    const names = (payload.models ?? [])
      .map((item) => (item.name || "").trim())
      .filter(Boolean);
    if (!names.length) return FALLBACK_OLLAMA_MODEL;
    const prefer = names.find(
      (name) => name === DEFAULT_OLLAMA_MODEL || name.startsWith(`${DEFAULT_OLLAMA_MODEL}:`),
    );
    if (prefer) return prefer;
    const qwen = names.find((name) => /^qwen/i.test(name));
    if (qwen) return qwen;
    return names[0]!;
  } catch {
    return FALLBACK_OLLAMA_MODEL;
  }
}

export async function runOllamaConductor(
  transcript: string,
  config: OllamaConductorConfig = {},
): Promise<OllamaConductorResult> {
  const text = clampOllamaTranscript(transcript);
  if (!text) return { ok: false, error: "Nothing to conduct.", unreachable: false };
  const resolved = resolveBase(config);
  if (!resolved.ok) return { ok: false, error: resolved.error, unreachable: false };
  const model = await resolveOllamaModel(config);
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 20_000;
  const base = resolved.base;
  let response: Response;
  try {
    response = await fetchImpl(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content: "You are a terse voice conductor. Reply in one short spoken sentence.",
          },
          { role: "user", content: text },
        ],
      }),
    });
  } catch {
    return { ok: false, error: ollamaUnreachableMessage(base), unreachable: true };
  }
  if (!response.ok) {
    const missing =
      response.status === 404
        ? ` Model "${model}" was not found — pull it or set amcos.ollama.model to an installed tag.`
        : "";
    return {
      ok: false,
      error: `Ollama returned ${response.status} at ${base}.${missing} Orchestrator did not complete. Switch Voice mode to Direct, or fix Ollama and try again.`,
      unreachable: response.status === 0 || response.status >= 500,
    };
  }
  let payload: { message?: { content?: string }; model?: string };
  try {
    payload = (await response.json()) as { message?: { content?: string }; model?: string };
  } catch {
    return { ok: false, error: "Ollama returned a response that could not be read.", unreachable: false };
  }
  const reply = payload.message?.content?.trim() ?? "";
  if (!reply) return { ok: false, error: "Ollama returned an empty reply.", unreachable: false };
  return { ok: true, text: reply, model: payload.model || model };
}

/** Lightweight reachability check (GET /api/tags). Does not spend a chat turn. */
export async function probeOllamaConductor(
  config: OllamaConductorConfig = {},
): Promise<OllamaConductorResult> {
  const resolved = resolveBase(config);
  if (!resolved.ok) return { ok: false, error: resolved.error, unreachable: false };
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 3_000;
  try {
    const response = await fetchImpl(`${resolved.base}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, error: OLLAMA_UNREACHABLE, unreachable: true };
    }
    return { ok: true, text: "ok", model: await resolveOllamaModel(config) };
  } catch {
    return { ok: false, error: OLLAMA_UNREACHABLE, unreachable: true };
  }
}
