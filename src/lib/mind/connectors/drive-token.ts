/**
 * Drive token helper for the media lane's cloud file picker.
 * Media reads connection status from the same `.data/mind-connectors` records
 * (`google_drive.json`) and can call this to decrypt / refresh a Bearer token server-side.
 * Never returns ciphertext to callers. Never logs token values.
 */
import { getAccessToken, readConnection, type ConnectionPublic, toPublic } from "./store.ts";
import { getProvider } from "./providers.ts";
import { providerConfigured } from "./oauth-provider.ts";
import { mintStorageAccessToken } from "./storage-token-refresh.ts";

export function resolveGoogleDriveAccessToken(ownerId: string): { ok: true; token: string } | { ok: false; error: string } {
  const token = getAccessToken(ownerId, "google_drive");
  if (token) return { ok: true, token };
  const record = readConnection(ownerId, "google_drive");
  if (!record) {
    return {
      ok: false,
      error: "Google Drive is not connected. Open ServiceBoard and connect Google Drive.",
    };
  }
  return {
    ok: false,
    error: "Google Drive connection record exists but the access token could not be decrypted. Use resolveGoogleDriveAccessTokenAsync to refresh.",
  };
}

export async function resolveGoogleDriveAccessTokenAsync(
  ownerId: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const sync = resolveGoogleDriveAccessToken(ownerId);
  if (sync.ok) return sync;
  const minted = await mintStorageAccessToken(ownerId, "google_drive");
  if (minted.ok) return { ok: true, token: minted.accessToken };
  if (!readConnection(ownerId, "google_drive")) {
    return {
      ok: false,
      error: "Google Drive is not connected. Open ServiceBoard and connect Google Drive.",
    };
  }
  return { ok: false, error: minted.error };
}

export function googleDriveConnectionPublic(ownerId: string): ConnectionPublic {
  const provider = getProvider("google_drive");
  return toPublic("google_drive", readConnection(ownerId, "google_drive"), providerConfigured(provider.readEnv()));
}
