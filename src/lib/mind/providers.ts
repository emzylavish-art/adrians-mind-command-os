export type ProviderId = "grok" | "openai" | "anthropic" | "gemini" | "openrouter";

export type ProviderRecord = {
  id: ProviderId;
  label: string;
  live: boolean;
  model: string | null;
  reason: string;
};

export const PROVIDERS: ProviderRecord[] = [
  { id: "grok", label: "Grok 4.5", live: true, model: "grok-4.5", reason: "The server key is used only when you send." },
  { id: "openai", label: "GPT", live: false, model: null, reason: "No OpenAI key is configured." },
  { id: "anthropic", label: "Claude", live: false, model: null, reason: "No Anthropic key is configured." },
  { id: "gemini", label: "Gemini", live: false, model: null, reason: "No Gemini key is configured." },
  { id: "openrouter", label: "OpenRouter", live: false, model: null, reason: "No OpenRouter key is configured." },
];

export function resolveProvider(id: string, fallback: boolean): { ok: true; id: "grok"; model: "grok-4.5" } | { ok: false; error: string } {
  const found = PROVIDERS.find((item) => item.id === id);
  if (!found) return { ok: false, error: "That provider is not known." };
  if (!found.live || found.id !== "grok" || !found.model) {
    return { ok: false, error: fallback ? `${found.reason} Another provider is not substituted.` : found.reason };
  }
  return { ok: true, id: "grok", model: "grok-4.5" };
}

export function providerChoices(grokConfigured: boolean | null) {
  return PROVIDERS.map((item) => ({
    id: item.id,
    label: item.label,
    enabled: item.id === "grok" && grokConfigured !== false,
    reason:
      item.id === "grok"
        ? grokConfigured === true
          ? "Configured. A live request was not verified in the last test."
          : grokConfigured === false
            ? "No Grok key is configured on the server."
            : "Status has not finished. Send still uses Grok only."
        : `${item.reason} It cannot be selected.`,
  }));
}

export function chosenProvider(choice: string, grokConfigured: boolean | null): { ok: true; id: "grok"; model: "grok-4.5" } | { ok: false; error: string } {
  const match = providerChoices(grokConfigured).find((item) => item.id === choice);
  if (!match) return { ok: false, error: "That provider is not known. Another provider is not substituted." };
  if (!match.enabled) return { ok: false, error: `${match.reason} Another provider is not substituted.` };
  return assertLiveProvider(match.id);
}

/** Accept an omitted provider as Grok. Any other value fails and is not rewritten. */
export function assertLiveProvider(id: unknown): { ok: true; id: "grok"; model: "grok-4.5" } | { ok: false; error: string } {
  if (id == null || id === "") return resolveProvider("grok", false);
  if (typeof id !== "string") return { ok: false, error: "That provider is not known." };
  return resolveProvider(id, true);
}

