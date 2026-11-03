/** Multi-account cloud storage rotation types (server-only). */

export const STORAGE_SERVICES = ["google_drive", "dropbox", "onedrive", "pcloud"] as const;
export type StorageService = (typeof STORAGE_SERVICES)[number];

export type StorageAccountConfig = {
  service: StorageService;
  /** Placeholder or real account email — never a secret. */
  accountEmail: string;
  /** Soft quota ceiling in bytes (free-tier defaults: Drive 15GB, Dropbox 2GB, OneDrive 5GB). */
  capBytes: number;
  /** Lower order uploads first (1 = Drive default). */
  order: number;
  enabled: boolean;
  /**
   * Optional Media Storage Fleet lane id (e.g. gdrive-emmanuelohilebo4).
   * When set, credentials resolve for this lane only (lane-scoped env + credentialOwnerId).
   */
  laneId?: string;
  /**
   * Owner id whose encrypted StoredConnection holds tokens for this account.
   * Defaults to the signed-in owner. Use when the storage Google/Microsoft account
   * differs from the app session owner (multi-lane).
   */
  credentialOwnerId?: string;
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
  laneId?: string;
  credentialOwnerId?: string;
};

/** Default free-tier caps (bytes). */
export const DEFAULT_CAPS = {
  google_drive: 15 * 1024 * 1024 * 1024, // 15 GiB
  dropbox: 2 * 1024 * 1024 * 1024, // 2 GiB
  onedrive: 5 * 1024 * 1024 * 1024, // 5 GiB
  pcloud: 10 * 1024 * 1024 * 1024, // 10 GiB free-tier default
} as const;

export const DEFAULT_SWITCH_THRESHOLD = 0.9;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MiB per request (route cap)
export const MEDIA_REMOTE_ROOT = "AdriansMind";
