/**
 * Voice Connection Hub — one-file adapter interface.
 * Drop a file in adapters/ that default-exports `createAdapter` or exports `adapter`.
 * Auto-discovered; no core edits required.
 */
export type AdapterHealth = {
  ok: boolean;
  status: string;
  detail?: string;
  watermark?: { enabled: boolean; name: string | null; note: string } | null;
  backend?: string | null;
};

export type AdapterVoice = {
  voiceId: string;
  name?: string;
  meta?: Record<string, unknown>;
};

export type AdapterCreateInput = {
  name: string;
  profileId?: string;
  /** Studio-issued consent proof — hub refuses without it. */
  consentToken: string;
  consentRecordId: string;
  fileBytes: Uint8Array;
  filename: string;
  mime: string;
  language?: string;
};

export type AdapterSynthInput = {
  voiceId: string;
  text: string;
  format?: "wav" | "mp3";
};

export type VoiceProviderAdapter = {
  id: string;
  label: string;
  /** When true, adapter is listed but create/synth refuse with honest message. */
  disabled?: boolean;
  health(): Promise<AdapterHealth>;
  listVoices(): Promise<AdapterVoice[]>;
  createVoice(input: AdapterCreateInput): Promise<{ voiceId: string }>;
  synthesize(input: AdapterSynthInput): Promise<{ bytes: Uint8Array; mime: string }>;
  deleteVoice(voiceId: string): Promise<{ deleted: boolean }>;
};

export type AdapterFactory = (env: Record<string, string | undefined>) => VoiceProviderAdapter;
