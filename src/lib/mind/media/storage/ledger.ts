import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { StorageService } from "./types.ts";

/**
 * Local usage ledger — fallback when live quota APIs are unavailable.
 * Concurrent uploads take an exclusive lock file (O_EXCL) around read-modify-write.
 * NEVER deletes remote media; only tracks uploaded byte totals locally.
 */

export type LedgerEntry = {
  service: StorageService;
  accountEmail: string;
  usedBytes: number;
  updatedAt: string;
};

export type LedgerFile = {
  version: 1;
  accounts: Record<string, LedgerEntry>;
};

function accountKey(service: StorageService, accountEmail: string) {
  return `${service}::${accountEmail.toLowerCase()}`;
}

let ledgerPath = join(process.cwd(), ".data", "media-storage-ledger.json");

export function setStorageLedgerPath(next: string) {
  ledgerPath = next;
}

export function storageLedgerPath() {
  return ledgerPath;
}

function emptyLedger(): LedgerFile {
  return { version: 1, accounts: {} };
}

function readLedgerUnlocked(path: string): LedgerFile {
  if (!existsSync(path)) return emptyLedger();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LedgerFile;
    if (!parsed || typeof parsed !== "object" || !parsed.accounts) return emptyLedger();
    return { version: 1, accounts: parsed.accounts };
  } catch {
    return emptyLedger();
  }
}

function writeLedgerUnlocked(path: string, data: LedgerFile) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, path);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Acquire an exclusive lock via O_EXCL create. Retries briefly for concurrent uploads.
 */
export async function withLedgerLock<T>(
  fn: () => T | Promise<T>,
  opts: { lockPath?: string; retries?: number; delayMs?: number } = {},
): Promise<T> {
  const lockPath = opts.lockPath ?? `${ledgerPath}.lock`;
  const retries = opts.retries ?? 40;
  const delayMs = opts.delayMs ?? 25;
  mkdirSync(dirname(lockPath), { recursive: true });
  let fd: number | null = null;
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch (err) {
      lastErr = err;
      await sleep(delayMs);
    }
  }
  if (fd == null) {
    throw new Error(`Could not acquire storage ledger lock after ${retries} attempts: ${String(lastErr)}`);
  }
  try {
    return await fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

export function readLedgerUsed(service: StorageService, accountEmail: string, path = ledgerPath): number {
  const key = accountKey(service, accountEmail);
  const ledger = readLedgerUnlocked(path);
  return ledger.accounts[key]?.usedBytes ?? 0;
}

export async function bumpLedgerUsed(
  service: StorageService,
  accountEmail: string,
  deltaBytes: number,
  path = ledgerPath,
): Promise<number> {
  if (!Number.isFinite(deltaBytes) || deltaBytes < 0) {
    throw new Error("Ledger bump requires a non-negative byte delta.");
  }
  return withLedgerLock(() => {
    const ledger = readLedgerUnlocked(path);
    const key = accountKey(service, accountEmail);
    const prev = ledger.accounts[key]?.usedBytes ?? 0;
    const next = prev + Math.floor(deltaBytes);
    ledger.accounts[key] = {
      service,
      accountEmail,
      usedBytes: next,
      updatedAt: new Date().toISOString(),
    };
    writeLedgerUnlocked(path, ledger);
    return next;
  }, { lockPath: `${path}.lock` });
}

export async function setLedgerUsed(
  service: StorageService,
  accountEmail: string,
  usedBytes: number,
  path = ledgerPath,
): Promise<void> {
  await withLedgerLock(() => {
    const ledger = readLedgerUnlocked(path);
    const key = accountKey(service, accountEmail);
    ledger.accounts[key] = {
      service,
      accountEmail,
      usedBytes: Math.max(0, Math.floor(usedBytes)),
      updatedAt: new Date().toISOString(),
    };
    writeLedgerUnlocked(path, ledger);
  }, { lockPath: `${path}.lock` });
}
