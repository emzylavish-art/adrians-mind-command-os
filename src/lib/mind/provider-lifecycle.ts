export function providerRestriction(status: number): string | null {
  if (status === 401 || status === 403) return "credentials_rejected";
  if (status === 402) return "billing_required";
  if (status === 429) return "rate_limited";
  return null;
}

/** A bounded cooldown permits a later explicit attempt; it never schedules a paid retry. */
export function providerRetryAt(value: string | null | undefined, now = Date.now()): string {
  const seconds = Number(value);
  const parsed = value && !Number.isFinite(seconds) ? Date.parse(value) : NaN;
  const proposed = value && Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Number.isFinite(parsed) ? parsed : now + 60_000;
  return new Date(Math.min(now + 24 * 60 * 60_000, Math.max(now + 1000, proposed))).toISOString();
}

export function preserveProviderModel(selected: string, models: string[]): { model: string; available: boolean } {
  // First discovery can establish the default. Later discovery cannot replace an explicit selection.
  const model = selected || models[0] || "";
  return { model, available: Boolean(model && models.includes(model)) };
}

export type ProviderCapabilities = {
  answer: "implemented";
  images: "implemented" | "unknown";
  transcription: "implemented" | "not_wired" | "unknown";
  speech: "implemented" | "not_wired" | "unknown";
  realtime: "not_wired" | "unknown";
  streaming: "implemented" | "not_wired";
};

/** Adapter evidence, not a claim of upstream availability, account access or successful inference. */
export function implementedProviderCapabilities(host: string): ProviderCapabilities {
  const audio = host === "api.x.ai" || host === "api.openai.com";
  const known = audio || host === "api.anthropic.com" || host === "generativelanguage.googleapis.com" || host === "openrouter.ai";
  return { answer: "implemented", images: known ? "implemented" : "unknown", transcription: audio ? "implemented" : known ? "not_wired" : "unknown", speech: audio ? "implemented" : known ? "not_wired" : "unknown", realtime: known ? "not_wired" : "unknown", streaming: "implemented" };
}
