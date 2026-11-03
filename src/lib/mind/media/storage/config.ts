import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_CAPS,
  DEFAULT_SWITCH_THRESHOLD,
  STORAGE_SERVICES,
  type StorageAccountConfig,
  type StorageAccountsFile,
  type StorageService,
} from "./types.ts";

const DEFAULT_ACCOUNTS: StorageAccountConfig[] = [
  {
    service: "supabase",
    accountEmail: "media@xarxhdsnprpnosimehon.supabase.co",
    capBytes: DEFAULT_CAPS.supabase,
    order: 1,
    enabled: true,
  },
  {
    service: "google_drive",
    accountEmail: "drive-placeholder@example.com",
    capBytes: DEFAULT_CAPS.google_drive,
    order: 2,
    enabled: true,
  },
  {
    service: "dropbox",
    accountEmail: "dropbox-placeholder@example.com",
    capBytes: DEFAULT_CAPS.dropbox,
    order: 3,
    enabled: true,
  },
  {
    service: "onedrive",
    accountEmail: "onedrive-placeholder@example.com",
    capBytes: DEFAULT_CAPS.onedrive,
    order: 4,
    enabled: true,
  },
];

let configPath = join(process.cwd(), ".data", "media-storage-accounts.json");

export function setStorageAccountsConfigPath(next: string) {
  configPath = next;
}

export function storageAccountsConfigPath() {
  return configPath;
}

export function defaultStorageAccountsFile(): StorageAccountsFile {
  return {
    version: 1,
    switchThreshold: DEFAULT_SWITCH_THRESHOLD,
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
  };
}

function isService(value: unknown): value is StorageService {
  return typeof value === "string" && (STORAGE_SERVICES as readonly string[]).includes(value);
}

function normalizeAccount(raw: unknown, index: number): StorageAccountConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!isService(row.service)) return null;
  const email = typeof row.accountEmail === "string" && row.accountEmail.trim() ? row.accountEmail.trim() : `${row.service}-placeholder@example.com`;
  const cap =
    typeof row.capBytes === "number" && Number.isFinite(row.capBytes) && row.capBytes > 0
      ? Math.floor(row.capBytes)
      : DEFAULT_CAPS[row.service];
  const order =
    typeof row.order === "number" && Number.isFinite(row.order) ? Math.floor(row.order) : index + 1;
  const enabled = row.enabled !== false;
  return { service: row.service, accountEmail: email, capBytes: cap, order, enabled };
}

export function loadStorageAccountsConfig(path = configPath): StorageAccountsFile {
  if (!existsSync(path)) return defaultStorageAccountsFile();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StorageAccountsFile>;
    const accounts = Array.isArray(parsed.accounts)
      ? parsed.accounts.map(normalizeAccount).filter((a): a is StorageAccountConfig => a != null)
      : [];
    if (accounts.length === 0) return defaultStorageAccountsFile();
    const threshold =
      typeof parsed.switchThreshold === "number" &&
      parsed.switchThreshold > 0 &&
      parsed.switchThreshold <= 1
        ? parsed.switchThreshold
        : DEFAULT_SWITCH_THRESHOLD;
    return { version: 1, switchThreshold: threshold, accounts };
  } catch {
    return defaultStorageAccountsFile();
  }
}

export function orderedEnabledAccounts(config = loadStorageAccountsConfig()): StorageAccountConfig[] {
  return [...config.accounts].filter((a) => a.enabled).sort((a, b) => a.order - b.order);
}
