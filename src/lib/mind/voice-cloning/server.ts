/**
 * Server functions for Voice Cloning Studio.
 * Auth via authMiddleware (same pattern as speakText). Keys never returned to client.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { createVoiceCloningService } from "./service.ts";
import { authorizeExternalResource } from "../external-resource-call.server.ts";

function svc() {
  return createVoiceCloningService({ authorize: ({ owner, provider, operation, free }) => authorizeExternalResource(owner, provider, `voice-clone:${operation}`, undefined, free) });
}

export const vcsProviderStatus = createServerFn({ method: "GET" }).handler(async () => {
  return svc().getStatus();
});

export const vcsListProfiles = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return { ok: true as const, profiles: svc().listProfiles(context.userId) };
  });

export const vcsCreateChallenge = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const challenge = await svc().createChallenge(context.userId);
      return { ok: true as const, challenge };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create consent challenge.";
      return { ok: false as const, error: message };
    }
  });

export const vcsCreateProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    name: string;
    attestation: "own_voice" | "written_permission";
    challengeId: string;
    consentAudioBase64: string;
    consentMime: string;
    sampleAudioBase64: string;
    sampleMime: string;
  }) => input)
  .handler(async ({ data, context }) => {
    return svc().createProfile(context.userId, data);
  });

export const vcsGenerate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { profileId: string; text: string }) => input)
  .handler(async ({ data, context }) => {
    return svc().generate(context.userId, data);
  });

export const vcsDeleteProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { profileId: string }) => input)
  .handler(async ({ data, context }) => {
    return svc().deleteProfile(context.userId, data.profileId);
  });

export const vcsExportAudio = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: {
    profileId: string;
    audioBase64: string;
    sourceMime: string;
    format: "mp3" | "wav";
  }) => input)
  .handler(async ({ data, context }) => {
    return svc().exportGeneratedAudio(context.userId, data);
  });

export const vcsExportConsent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { profileId: string }) => input)
  .handler(async ({ data, context }) => {
    return svc().exportConsentRecord(context.userId, data.profileId);
  });
