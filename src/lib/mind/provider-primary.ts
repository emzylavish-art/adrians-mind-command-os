/**
 * Non-Grok PRIMARY turn (user picked OpenAI/Anthropic/Gemini/OpenRouter).
 *
 * The provider gets the SAME assembled context the Grok primary gets — assembleTurn's
 * messages (system/persona prompt, memory notes, history, current turn) — flattened to text
 * by the shared provider-call builder. Prior-turn images become text stubs; a current turn
 * with images is refused (these provider paths are text-only). The done event reports only
 * the memory notes that were actually sent, and flags a reply cut off at the output limit.
 */
import { callConfiguredProvider, toTextOnlyMessages, type AssembledMessage } from "./provider-call.ts";
import { extractProviderText, noteIdsSent, providerFinish, sanitizeProviderError, type FallbackId } from "./failover.ts";

export { noteIdsSent };

const STOPPED = "Stopped. The unfinished reply was not saved.";

type FetchLike = Parameters<typeof callConfiguredProvider>[0]["fetch"];

export type PrimaryDone = {
  text: string;
  model: string;
  provider: FallbackId;
  usage: null;
  usedIds: string[];
  requestId: null;
  truncated?: true;
};

export function hasImageParts(message: AssembledMessage | undefined): boolean {
  return Boolean(
    message && Array.isArray(message.content) && message.content.some((p) => p && typeof p === "object" && (p as { type?: unknown }).type === "image_url"),
  );
}

export async function runProviderPrimary(input: {
  id: FallbackId;
  model: string;
  key: string;
  messages: readonly AssembledMessage[];
  usedIds: readonly string[];
  fetch: FetchLike;
  signal?: AbortSignal;
}): Promise<{ ok: true; done: PrimaryDone } | { ok: false; error: string; aborted?: true }> {
  const secrets = [input.key];
  const messages: readonly AssembledMessage[] = Array.isArray(input.messages) ? input.messages : [];
  const current = messages[messages.length - 1];
  if (hasImageParts(current)) {
    return { ok: false, error: `${input.id} cannot see images in this app (text-only). Choose Grok, or remove the attached images. Nothing was sent.` };
  }
  const flat = toTextOnlyMessages(messages);
  const last = flat[flat.length - 1];
  if (!current || current.role !== "user" || !last || last.role !== "user" || !last.content.trim()) {
    return { ok: false, error: `There was no message to send to ${input.id}. Nothing was sent.` };
  }
  if (input.signal?.aborted) return { ok: false, error: STOPPED, aborted: true };
  let called: Awaited<ReturnType<typeof callConfiguredProvider>>;
  try {
    called = await callConfiguredProvider({ id: input.id, key: input.key, messages, fetch: input.fetch });
  } catch {
    called = { ok: false, text: "", error: `${input.id} could not be reached. Nothing was substituted.` };
  }
  if (input.signal?.aborted) return { ok: false, error: STOPPED, aborted: true };
  const text = called.ok ? extractProviderText(input.id, called.text) : "";
  if (!text) {
    return { ok: false, error: sanitizeProviderError(called.ok ? `${input.id} returned an empty reply.` : called.error, secrets) };
  }
  const finish = providerFinish(input.id, called.text);
  return {
    ok: true,
    done: {
      text,
      model: input.model,
      provider: input.id,
      usage: null,
      usedIds: noteIdsSent(input.usedIds, flat),
      requestId: null,
      ...(finish.truncated ? { truncated: true as const } : {}),
    },
  };
}
