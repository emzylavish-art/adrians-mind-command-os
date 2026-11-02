import type { StorageProvider, StorageService } from "../types.ts";
import { createGoogleDriveProvider } from "./google-drive.ts";
import { createDropboxProvider } from "./dropbox.ts";
import { createOneDriveProvider } from "./onedrive.ts";
import { createSupabaseProvider } from "./supabase.ts";

export { createGoogleDriveProvider, GOOGLE_DRIVE_FORBIDDEN_OPS } from "./google-drive.ts";
export { createDropboxProvider, DROPBOX_FORBIDDEN_OPS } from "./dropbox.ts";
export { createOneDriveProvider, ONEDRIVE_FORBIDDEN_OPS } from "./onedrive.ts";
export { createSupabaseProvider, bucketForUpload, SUPABASE_FORBIDDEN_OPS } from "./supabase.ts";
export type { SupabaseMediaBucket } from "./supabase.ts";

export function createDefaultProviders(
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Record<StorageService, StorageProvider> {
  return {
    supabase: createSupabaseProvider(fetchImpl, env),
    google_drive: createGoogleDriveProvider(fetchImpl),
    dropbox: createDropboxProvider(fetchImpl),
    onedrive: createOneDriveProvider(fetchImpl),
  };
}
