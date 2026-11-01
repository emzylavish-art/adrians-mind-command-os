export type OllamaConductorConfig = {
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type OllamaConductorResult =
  | { ok: true; text: string; model: string }
  | { ok: false; error: string; unreachable: boolean };

export const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "llama3.2";

export const OLLAMA_UNREACHABLE =
  "The local Ollama conductor is unreachable at the configured host. Orchestrator mode needs Ollama running; nothing was sent to a cloud model.";

export async function runOllamaConductor(
  transcript: string,
  config: OllamaConductorConfig = {},
): Promise<OllamaConductorResult> {
  const text = transcript.trim();
  if (!text) return { ok: false, error: "Nothing to conduct.", unreachable: false };
  const base = (config.baseUrl || DEFAULT_OLLAMA_BASE).replace(/\/$/, "");
  const model = config.model || DEFAULT_OLLAMA_MODEL;
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 20_000;
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
