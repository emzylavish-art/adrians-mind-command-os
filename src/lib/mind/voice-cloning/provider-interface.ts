/** Shared Voice Cloning Studio provider contract (model-agnostic). */
import type { ProviderStatusReport, VoiceCloneProviderId } from "./types.ts";

export type CreateCustomVoiceResult =
  | { ok: true; voiceId: string }
  | { ok: false; code: "not_configured" | "rejected" | "network" | "invalid" | "unsafe_url"; error: string };

export type DeleteCustomVoiceResult =
  | { ok: true; deleted: boolean }
  | { ok: false; error: string };

export type TtsResult =
  | { ok: true; bytes: Uint8Array; mime: string }
  | { ok: false; error: string; code?: string };

export type VoiceCloneProvider = {
  id: VoiceCloneProviderId;
  status(): Promise<ProviderStatusReport>;
  createVoice(input: {
    name: string;
    profileId?: string;
    language?: string;
    fileBytes: Uint8Array;
    filename: string;
    mime: string;
    /** Required when provider is the Voice Hub. */
    consentToken?: string;
    consentRecordId?: string;
  }): Promise<CreateCustomVoiceResult>;
  deleteVoice(voiceId: string): Promise<DeleteCustomVoiceResult>;
  synthesize(input: { text: string; voiceId: string; format?: "mp3" | "wav" }): Promise<TtsResult>;
};
