import { probeOllamaConductor, OLLAMA_UNREACHABLE } from "../voice/ollama-conductor.ts";

export type OllamaBadgeStatus =
  | { ok: true; detail: null; detailTone: "muted" }
  | { ok: false; detail: string; detailTone: "danger" };

/** Probe local Ollama for Orchestrator badge clarity (never silent). */
export async function probeOllamaForBadge(input?: {
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<OllamaBadgeStatus> {
  const result = await probeOllamaConductor({
    baseUrl: input?.baseUrl,
    model: input?.model,
    fetchImpl: input?.fetchImpl,
  });
  if (result.ok) return { ok: true, detail: null, detailTone: "muted" };
  return {
    ok: false,
    detail: result.error || OLLAMA_UNREACHABLE,
    detailTone: "danger",
  };
}
