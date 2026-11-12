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

export function providerChoices(grokConfigured: boolean | null, verifiedModel?: string | null) {
  return providerChoicesWithKeys(grokConfigured, verifiedModel, {});
}

export function providerChoicesWithKeys(
  grokConfigured: boolean | null,
  verifiedModel: string | null | undefined,
  keys: Partial<Record<"openai" | "anthropic" | "gemini" | "openrouter", boolean>>,
) {
  const verified = typeof verifiedModel === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,80}$/.test(verifiedModel)
    ? verifiedModel
    : "";
  return PROVIDERS.map((item) => ({
    id: item.id,
    label: item.label,
    enabled: item.id === "grok" ? grokConfigured !== false : keys[item.id] === true,
    reason:
      item.id === "grok"
        ? grokConfigured === true
          ? verified
            ? `Live. The last reply used ${verified}.`
            : "Configured. Send a message to verify a live reply."
          : grokConfigured === false
            ? "No Grok key is configured on the server."
            : "Status has not finished. Send still uses Grok only."
        : keys[item.id] === true
          ? "Key present. Select it to send through this provider."
          : `${item.reason} It cannot be selected.`,
  }));
}

export function chosenProvider(choice: string, grokConfigured: boolean | null): { ok: true; id: "grok"; model: "grok-4.5" } | { ok: false; error: string } {
  const match = providerChoices(grokConfigured).find((item) => item.id === choice);
  if (!match) return { ok: false, error: "That provider is not known. Another provider is not substituted." };
  if (!match.enabled) return { ok: false, error: `${match.reason} Another provider is not substituted.` };
  return assertLiveProvider(match.id);
}

/** Failover is explicit. The default policy does not switch providers. */
export function failover(
  requested: string,
  grokConfigured: boolean,
  policy: "none" | "grok",
): { provider: "grok" | null; switched: boolean; note: string } {
  if (requested === "grok" || requested === "") {
    return grokConfigured
      ? { provider: "grok", switched: false, note: "Grok remains the selected provider." }
      : { provider: null, switched: false, note: "Grok is not configured. Nothing was substituted." };
  }
  if (policy === "grok" && grokConfigured) {
    return { provider: "grok", switched: true, note: `${requested} was not used. A switch to Grok was allowed and is recorded.` };
  }
  return { provider: null, switched: false, note: `${requested} is not configured. Another provider is not substituted.` };
}
export function assertLiveProvider(id: unknown): { ok: true; id: "grok"; model: "grok-4.5" } | { ok: false; error: string } {
  if (id == null || id === "") return resolveProvider("grok", false);
  if (typeof id !== "string") return { ok: false, error: "That provider is not known." };
  return resolveProvider(id, true);
}
