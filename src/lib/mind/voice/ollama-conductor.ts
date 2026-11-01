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
export const DEFAULT_OLLAMA_MODEL = "llama3.2";

export const OLLAMA_UNREACHABLE =
  "The local Ollama conductor is unreachable at the configured host. Orchestrator mode needs Ollama running; nothing was sent to a cloud model.";

function resolveBase(config: OllamaConductorConfig) {
  const allowRemote = config.allowRemote ?? ollamaAllowRemoteFromEnv(config.env ?? process.env);
  return resolveSafeOllamaBase(config.baseUrl, { allowRemote, fallback: DEFAULT_OLLAMA_BASE });
}

export async function runOllamaConductor(
  transcript: string,
  config: OllamaConductorConfig = {},
): Promise<OllamaConductorResult> {
  const text = clampOllamaTranscript(transcript);
  if (!text) return { ok: false, error: "Nothing to conduct.", unreachable: false };
  const resolved = resolveBase(config);
  if (!resolved.ok) return { ok: false, error: resolved.error, unreachable: false };
  const model = config.model || DEFAULT_OLLAMA_MODEL;
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 20_000;
  let response: Response;
  try {
    response = await fetchImpl(`${resolved.base}/api/chat`, {
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
    return { ok: false, error: OLLAMA_UNREACHABLE, unreachable: true };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: `Ollama returned ${response.status}. Orchestrator did not complete.`,
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
    return { ok: true, text: "ok", model: config.model || DEFAULT_OLLAMA_MODEL };
  } catch {
    return { ok: false, error: OLLAMA_UNREACHABLE, unreachable: true };
  }
}
