/**
 * Cheap cached sign-in gate for live Speak.
 * Updated from React (useCurrentUserState); read sync in the click/start path
 * so we never call getUserMedia before knowing the user is signed out.
 */

import { VOICE_SIGN_IN_REQUIRED } from "../voice/errors.ts";

export type VoiceAuthCache = {
  /** Auth is disabled → treat as signed in (dev fallback user). */
  authEnabled: boolean;
  signedIn: boolean;
  pending: boolean;
  updatedAt: number;
};

let cache: VoiceAuthCache | null = null;

export function setVoiceAuthCache(next: {
  authEnabled: boolean;
  signedIn: boolean;
  pending: boolean;
}): void {
  cache = {
    authEnabled: next.authEnabled,
    signedIn: next.signedIn,
    pending: next.pending,
    updatedAt: Date.now(),
  };
}

export function readVoiceAuthCache(): VoiceAuthCache | null {
  return cache;
}

/** Test helper — clear between cases. */
export function resetVoiceAuthCache(): void {
  cache = null;
}

/**
 * Sync gate used before mic / mint.
 * - Auth off → ok
 * - Known signed-out (!pending) → fail with sign-in message (no mic)
 * - Pending / unknown → ok (mint still enforces; avoids blocking cold start forever)
 */
export function assertVoiceSignedInForMic(
  snapshot: VoiceAuthCache | null = cache,
): { ok: true } | { ok: false; error: string } {
  if (!snapshot) return { ok: true };
  if (!snapshot.authEnabled) return { ok: true };
  if (snapshot.pending) return { ok: true };
  if (!snapshot.signedIn) return { ok: false, error: VOICE_SIGN_IN_REQUIRED };
  return { ok: true };
}
