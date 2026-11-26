/** Audio recipients are an explicit stage preference, independent of the answer model. */
export type TranscriptionProvider = "xai" | "openai";
export type TranscriptionPolicy = { provider: TranscriptionProvider; allowFallback: boolean };
export const DEFAULT_TRANSCRIPTION_POLICY: TranscriptionPolicy = { provider: "xai", allowFallback: false };
export function parseTranscriptionPolicy(value: unknown): TranscriptionPolicy | null {
  if (value === undefined || value === null) return { ...DEFAULT_TRANSCRIPTION_POLICY };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.provider !== "xai" && row.provider !== "openai") return null;
  if (row.allowFallback !== undefined && typeof row.allowFallback !== "boolean") return null;
  return { provider: row.provider, allowFallback: row.allowFallback === true };
}
export function transcriptionPolicyKey(owner: string | null): string {
  return `amcos.voice.transcription.v1:${encodeURIComponent(owner ?? "guest")}`;
}
export function readTranscriptionPolicy(storage: Pick<Storage, "getItem"> | null, owner: string | null): TranscriptionPolicy {
  try { return parseTranscriptionPolicy(JSON.parse(storage?.getItem(transcriptionPolicyKey(owner)) ?? "null")) ?? { ...DEFAULT_TRANSCRIPTION_POLICY }; }
  catch { return { ...DEFAULT_TRANSCRIPTION_POLICY }; }
}
export function transcriptionRecipients(policy: TranscriptionPolicy): string {
  const first = policy.provider === "xai" ? "xAI" : "OpenAI";
  return policy.allowFallback ? `${first}, then ${policy.provider === "xai" ? "OpenAI" : "xAI"} if needed` : first;
}
