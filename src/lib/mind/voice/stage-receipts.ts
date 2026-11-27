export type VoiceStageName = "input" | "answer" | "output";
export const VOICE_RECEIPTS_KEY = "amcos.voice-receipts.v1";
export type VoiceStageEvidence = {
  selectedProvider: string | null;
  actualProvider: string | null;
  actualModel: string | null;
  requestId: string | null;
  state: "not_requested" | "pending" | "succeeded" | "failed";
  attempts: number;
  updatedAt: string;
};
export type VoiceStagesReceipt = {
  version: 1;
  operationId: string;
  input: VoiceStageEvidence;
  answer: VoiceStageEvidence;
  output: VoiceStageEvidence;
  playback: "not_requested" | "pending" | "played" | "failed" | "interrupted";
  updatedAt: string;
  /** Runtime attribution is not independent live-provider/device verification. */
  verified: false;
};
const safeText = (value: unknown): string | null => typeof value === "string" && value.trim() && !/^(?:Bearer\s|sk-|xai-)/i.test(value.trim()) && !/\p{Cc}/u.test(value)
  ? value.trim().slice(0, 240) : null;
const timestamp = (value: unknown, fallback = "") => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fallback;

export function createVoiceStagesReceipt(input: { operationId: string; inputProvider?: string; answerProvider?: string; outputProvider?: string; readAloud?: boolean }, now = new Date().toISOString()): VoiceStagesReceipt {
  const stage = (selected: string | undefined, requested: boolean): VoiceStageEvidence => ({ selectedProvider: safeText(selected), actualProvider: null, actualModel: null, requestId: null, state: requested ? "pending" : "not_requested", attempts: 0, updatedAt: now });
  return { version: 1, operationId: safeText(input.operationId) || "unreported", input: stage(input.inputProvider, !input.readAloud), answer: stage(input.answerProvider, !input.readAloud), output: stage(input.outputProvider, true), playback: "pending", updatedAt: now, verified: false };
}

/** Call only after the corresponding adapter returned. Never infer actual identity from selection. */
export function recordVoiceStage(receipt: VoiceStagesReceipt, stage: VoiceStageName, response: { ok: boolean; provider?: unknown; model?: unknown; requestId?: unknown }, now = new Date().toISOString()): VoiceStagesReceipt {
  return { ...receipt, [stage]: { ...receipt[stage], actualProvider: safeText(response.provider), actualModel: safeText(response.model), requestId: safeText(response.requestId), state: response.ok ? "succeeded" : "failed", attempts: receipt[stage].attempts + 1, updatedAt: now }, updatedAt: now, verified: false };
}

/** Cached audio replay changes playback only; it does not fabricate another provider dispatch. */
export function recordVoicePlayback(receipt: VoiceStagesReceipt, playback: VoiceStagesReceipt["playback"], now = new Date().toISOString()): VoiceStagesReceipt {
  return { ...receipt, playback, updatedAt: now, verified: false };
}

export function normalizeVoiceStagesReceipt(value: unknown): VoiceStagesReceipt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || !safeText(raw.operationId) || !["not_requested", "pending", "played", "failed", "interrupted"].includes(String(raw.playback)) || !timestamp(raw.updatedAt)) return undefined;
  const stages = {} as Record<VoiceStageName, VoiceStageEvidence>;
  for (const name of ["input", "answer", "output"] as const) {
    const data = raw[name]; if (!data || typeof data !== "object") return undefined;
    const entry = data as Record<string, unknown>;
    if (!["not_requested", "pending", "succeeded", "failed"].includes(String(entry.state)) || !Number.isSafeInteger(entry.attempts) || Number(entry.attempts) < 0 || !timestamp(entry.updatedAt)) return undefined;
    stages[name] = { selectedProvider: safeText(entry.selectedProvider), actualProvider: safeText(entry.actualProvider), actualModel: safeText(entry.actualModel), requestId: safeText(entry.requestId), state: entry.state as VoiceStageEvidence["state"], attempts: Number(entry.attempts), updatedAt: entry.updatedAt as string };
  }
  return { version: 1, operationId: safeText(raw.operationId)!, ...stages, playback: raw.playback as VoiceStagesReceipt["playback"], updatedAt: raw.updatedAt as string, verified: false };
}

/** Combine asynchronous stage updates only for the same captured voice operation. */
export function mergeVoiceStagesReceipt(previous: VoiceStagesReceipt, update: VoiceStagesReceipt): VoiceStagesReceipt {
  if (previous.operationId !== update.operationId) return previous;
  const newer = Date.parse(update.updatedAt) >= Date.parse(previous.updatedAt);
  const stages = Object.fromEntries((["input", "answer", "output"] as const).map(stage => [stage,
    update[stage].attempts > previous[stage].attempts || (update[stage].attempts === previous[stage].attempts && Date.parse(update[stage].updatedAt) >= Date.parse(previous[stage].updatedAt)) ? update[stage] : previous[stage],
  ])) as Pick<VoiceStagesReceipt, VoiceStageName>;
  return { ...previous, ...stages, playback: newer ? update.playback : previous.playback, updatedAt: newer ? update.updatedAt : previous.updatedAt, verified: false };
}

/** Metadata only: never persist microphone bytes, transcripts, prompts, or credentials here. */
export function readVoiceReceipts(storage: { getItem(key: string): string | null }): VoiceStagesReceipt[] {
  try {
    const raw = storage.getItem(VOICE_RECEIPTS_KEY);
    if (!raw || raw.length > 100_000) return [];
    const rows: unknown = JSON.parse(raw);
    return Array.isArray(rows) ? rows.slice(0, 20).flatMap((row) => { const receipt = normalizeVoiceStagesReceipt(row); return receipt ? [receipt] : []; }) : [];
  } catch { return []; }
}

export function storeVoiceReceipt(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }, receipt: VoiceStagesReceipt) {
  const valid = normalizeVoiceStagesReceipt(receipt);
  if (!valid) throw new Error("Voice receipt is invalid.");
  const previous = readVoiceReceipts(storage);
  const same = previous.find((item) => item.operationId === valid.operationId);
  storage.setItem(VOICE_RECEIPTS_KEY, JSON.stringify([same ? mergeVoiceStagesReceipt(same, valid) : valid, ...previous.filter((item) => item.operationId !== valid.operationId)].slice(0, 20)));
}
