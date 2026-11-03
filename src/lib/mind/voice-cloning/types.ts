/** Voice Cloning Studio types. Separate from Whisper Flow / builtin voices. */

export type ConsentAttestation =
  | "own_voice"
  | "written_permission";

export type VoiceCloneProviderId = "local-http" | "xai-custom-voices";

export type ProviderCloneStatus =
  | "ready"
  | "not_configured"
  | "error";

export type VoiceProfileStatus =
  | "active"
  | "provider_not_configured"
  | "deleted";

export type ConsentRecord = {
  id: string;
  profileId: string;
  userId: string;
  createdAt: string;
  attestation: ConsentAttestation;
  consentCode: string;
  phraseHash: string;
  transcriptNormalized: string;
  speakerName: string;
};

export type VoiceProfile = {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: VoiceProfileStatus;
  provider: VoiceCloneProviderId;
  providerVoiceId: string | null;
  providerStatus: ProviderCloneStatus;
  providerMessage: string;
  sampleBytes: number;
  sampleMime: string;
  consentId: string;
  deletedAt: string | null;
};

export type WatermarkStatus = {
  enabled: boolean;
  name: string | null;
  note: string;
};

export type ProviderStatusReport = {
  provider: VoiceCloneProviderId;
  /** Local engine base URL (safe to show); empty for cloud. */
  endpoint: string;
  voiceKeyPresent: boolean;
  canList: boolean;
  canClone: boolean;
  reason: string;
  /** Honest product copy for the Studio banner. */
  banner: string;
  probedAt: string;
  /** True when the configured provider is the optional xAI path. */
  xaiOptionalEnabled: boolean;
  /** From local /health — Chatterbox PerTh is enabled:true. */
  watermark: WatermarkStatus | null;
  backend: string | null;
};

export type ConsentChallenge = {
  challengeId: string;
  code: string;
  phrase: string;
  expiresAt: string;
};

export type CreateProfileInput = {
  name: string;
  attestation: ConsentAttestation;
  challengeId: string;
  consentAudioBase64: string;
  consentMime: string;
  sampleAudioBase64: string;
  sampleMime: string;
  sampleFilename?: string;
};

export type GenerateInput = {
  profileId: string;
  text: string;
};

export type GenerateResult =
  | { ok: true; audioBase64: string; mime: string }
  | { ok: false; error: string; code?: string };

export type DeleteResult =
  | { ok: true; profileId: string; deletedAt: string; providerDeleted: boolean; verifiable: true }
  | { ok: false; error: string; code?: string };

export type ExportAudioFormat = "mp3" | "wav";

export type ExportAudioResult =
  | {
      ok: true;
      filename: string;
      mime: string;
      audioBase64: string;
      format: ExportAudioFormat;
      profileId: string;
      profileName: string;
    }
  | { ok: false; error: string; code?: string };

export type ExportConsentResult =
  | {
      ok: true;
      filename: string;
      mime: "application/json";
      json: string;
      profileId: string;
    }
  | { ok: false; error: string; code?: string };
