import { DEFAULT_OLLAMA_BASE, ollamaUnreachableMessage } from "./ollama-conductor.ts";

export type OllamaProbeResult =
  | { ok: true; baseUrl: string }
  | { ok: false; baseUrl: string; error: string; hint: string };

/** Short reachability check for Orchestrator mode (GET /api/tags). */
export async function probeOllama(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<OllamaProbeResult> {
  const baseUrl = (options?.baseUrl || DEFAULT_OLLAMA_BASE).replace(/\/$/, "");
  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(options?.timeoutMs ?? 1500),
    });
    if (!response.ok) {
      return {
        ok: false,
        baseUrl,
        error: ollamaUnreachableMessage(baseUrl),
        hint: "Ollama not reachable",
      };
    }
    return { ok: true, baseUrl };
  } catch {
    return {
      ok: false,
      baseUrl,
      error: ollamaUnreachableMessage(baseUrl),
      hint: "Ollama not reachable",
    };
  }
}
