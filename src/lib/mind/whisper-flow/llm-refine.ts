/**
 * Optional server-side dictation polish via existing xAI chat completions.
 * Never used for local/open-source models. Keys stay server-side.
 * Callers must insert local refinement first; this must not block insertion.
 */

import { XAI_CHAT_URL, DEFAULT_XAI_MODEL } from "../xai-adapter.ts";

export const WHISPER_FLOW_LLM_REFINE_SYSTEM =
  "You polish short dictation transcripts for Adrian's Mind. " +
  "Fix capitalization and punctuation, remove fillers (um, uh, like), " +
  "and apply obvious self-corrections. " +
  "Return ONLY the polished transcript text with no quotes, labels, or commentary. " +
  "If the input is already fine, return it unchanged. Never invent facts.";

export type LlmRefineResult =
  | { ok: true; text: string }
  | { ok: false; error: string; skipped?: boolean };

/** Reject clearly unsafe / empty model output; keep local text instead. */
export function acceptPolishedText(original: string, polished: string): LlmRefineResult {
  const src = original.trim();
  const out = polished.trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!src) return { ok: false, error: "Nothing to refine.", skipped: true };
  if (!out) {
    return {
      ok: false,
      error: "Optional LLM refinement returned empty text. Local refinement was kept.",
      skipped: true,
    };
  }
  // Guardrail: refuse huge expansions (likely commentary).
  if (out.length > Math.max(80, src.length * 3)) {
    return {
      ok: false,
      error: "Optional LLM refinement looked unusable. Local refinement was kept.",
      skipped: true,
    };
  }
  return { ok: true, text: out };
}

export async function polishDictationWithXai(input: {
  text: string;
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<LlmRefineResult> {
  const text = input.text.trim().slice(0, 2000);
  if (!text) return { ok: false, error: "Nothing to refine.", skipped: true };
  if (!input.apiKey) {
    return {
      ok: false,
      error: "No chat model key is configured for optional refinement. Local refinement was kept.",
      skipped: true,
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const model = input.model || DEFAULT_XAI_MODEL;
  let response: Response;
  try {
    response = await fetchImpl(XAI_CHAT_URL, {
      method: "POST",
      signal: AbortSignal.timeout(input.timeoutMs ?? 12_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 512,
        messages: [
          { role: "system", content: WHISPER_FLOW_LLM_REFINE_SYSTEM },
          { role: "user", content: text },
        ],
      }),
    });
  } catch {
    return {
      ok: false,
      error: "Optional LLM refinement timed out. Local refinement was kept.",
      skipped: true,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: `Optional LLM refinement returned ${response.status}. Local refinement was kept.`,
      skipped: true,
    };
  }
  let payload: { choices?: Array<{ message?: { content?: string } }> };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return {
      ok: false,
      error: "Optional LLM refinement returned unreadable JSON. Local refinement was kept.",
      skipped: true,
    };
  }
  const content = payload.choices?.[0]?.message?.content ?? "";
  return acceptPolishedText(text, String(content));
}
