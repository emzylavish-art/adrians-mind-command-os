import type { StorageProvider, StorageService } from "../types.ts";
import { createGoogleDriveProvider } from "./google-drive.ts";
import { createDropboxProvider } from "./dropbox.ts";
import { createOneDriveProvider } from "./onedrive.ts";
import { createPcloudProvider } from "./pcloud.ts";
import { createBoxProvider } from "./box.ts";
import { createKoofrProvider } from "./koofr.ts";

export { createGoogleDriveProvider, GOOGLE_DRIVE_FORBIDDEN_OPS } from "./google-drive.ts";
export { createDropboxProvider, DROPBOX_FORBIDDEN_OPS } from "./dropbox.ts";
export { createOneDriveProvider, ONEDRIVE_FORBIDDEN_OPS } from "./onedrive.ts";
export { createPcloudProvider, PCLOUD_FORBIDDEN_OPS, resolvePcloudApiHost } from "./pcloud.ts";
export { createBoxProvider, BOX_FORBIDDEN_OPS } from "./box.ts";
export {
  createKoofrProvider,
  KOOFR_FORBIDDEN_OPS,
  KOOFR_DAV_HOST,
  buildKoofrDavUrl,
  packKoofrBasicToken,
  koofrAuthorizationHeader,
} from "./koofr.ts";

export function createDefaultProviders(
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Record<StorageService, StorageProvider> {
  return {
    google_drive: createGoogleDriveProvider(fetchImpl),
    dropbox: createDropboxProvider(fetchImpl),
    onedrive: createOneDriveProvider(fetchImpl),
    pcloud: createPcloudProvider(fetchImpl, env),
    box: createBoxProvider(fetchImpl),
    koofr: createKoofrProvider(fetchImpl),
  };
}
