/** Multi-account cloud storage rotation types (server-only). */

export const STORAGE_SERVICES = ["supabase", "google_drive", "dropbox", "onedrive", "pcloud"] as const;
export type StorageService = (typeof STORAGE_SERVICES)[number];

/** How an upload is filed into Supabase Storage buckets. Unknown lands in media-images. */
export type MediaStorageKind = "image" | "camera" | "video" | "audio" | "unknown";

export type StorageAccountConfig = {
  service: StorageService;
  /** Placeholder or real account email — never a secret. */
  accountEmail: string;
  /** Soft quota ceiling in bytes (free-tier defaults: Drive 15GB, Dropbox 2GB, OneDrive 5GB). */
  capBytes: number;
  /** Lower order uploads first (1 = Supabase when that account is configured). */
  order: number;
  enabled: boolean;
};

export type StorageAccountsFile = {
  version: 1;
  /** Switch when used + fileSize > cap × threshold (default 0.9). */
  switchThreshold: number;
  accounts: StorageAccountConfig[];
};

export type StorageQuota = {
  usedBytes: number;
  totalBytes: number;
  source: "live" | "ledger" | "unknown";
};

export type StorageHealth =
  | { ok: true; connected: true; detail?: string }
  | { ok: true; connected: false; detail: string }
  | { ok: false; connected: false; detail: string };

export type StorageUploadInput = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  /** Remote folder path segments under AdriansMind/, e.g. ["media", "imagine"]. */
  folderSegments?: string[];
  /**
   * Optional explicit kind. Supabase maps this to a private bucket.
   * When omitted, the provider infers a kind from mimeType and folderSegments.
   */
  mediaKind?: MediaStorageKind;
};

export type StorageUploadResult = {
  remoteId: string;
  remotePath: string;
  bytes: number;
  service: StorageService;
  accountEmail: string;
};

export type StorageProvider = {
  readonly service: StorageService;
  upload(input: StorageUploadInput & { accessToken: string }): Promise<StorageUploadResult>;
  quota(accessToken: string): Promise<StorageQuota>;
  health(accessToken: string | null): Promise<StorageHealth>;
};

export type StoreMediaInput = {
  ownerId: string;
  bytes: Uint8Array;
  fileName: string;
  mimeType?: string;
  folderSegments?: string[];
  /** Optional. Supabase bucket routing; other providers ignore it. */
  mediaKind?: MediaStorageKind;
};

export type StoreMediaSuccess = {
  ok: true;
  service: StorageService;
  accountEmail: string;
  remoteId: string;
  remotePath: string;
  bytes: number;
  usedBytes: number;
  capBytes: number;
  switchedFrom?: StorageService;
};

export type StoreMediaFailure = {
  ok: false;
  error: string;
  code: "storage_full" | "not_connected" | "invalid_input" | "upload_failed" | "unauthorized";
};

export type StoreMediaResult = StoreMediaSuccess | StoreMediaFailure;

export type AccountPublicStatus = {
  service: StorageService;
  accountEmail: string;
  enabled: boolean;
  order: number;
  connected: boolean;
  detail: string;
  usedBytes: number;
  capBytes: number;
  remainingBytes: number;
  nearCap: boolean;
  quotaSource: StorageQuota["source"];
};

/** Supabase free-plan project quota (1 GiB, same byte base as the other caps). */
export const SUPABASE_QUOTA_BYTES = 1 * 1024 * 1024 * 1024;

/** Supabase private buckets reject objects above this size. Rotation then tries the next provider. */
export const SUPABASE_MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Default free-tier caps (bytes). */
export const DEFAULT_CAPS = {
  supabase: SUPABASE_QUOTA_BYTES,
  google_drive: 15 * 1024 * 1024 * 1024, // 15 GiB
  dropbox: 2 * 1024 * 1024 * 1024, // 2 GiB
  onedrive: 5 * 1024 * 1024 * 1024, // 5 GiB
  pcloud: 10 * 1024 * 1024 * 1024, // 10 GiB free-tier default
} as const;

/** Per-provider object size ceiling. Omitted services accept any file under STORE_MEDIA_MAX_BYTES. */
export const PROVIDER_FILE_LIMITS: Partial<Record<StorageService, number>> = {
  supabase: SUPABASE_MAX_FILE_BYTES,
};

export const DEFAULT_SWITCH_THRESHOLD = 0.9;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MiB HTTP route cap (matches the Supabase object limit)
/** Direct storeMedia ceiling. Files above the Supabase object limit fall through to the next provider. */
export const STORE_MEDIA_MAX_BYTES = 512 * 1024 * 1024;
export const MEDIA_REMOTE_ROOT = "AdriansMind";
