/**
 * Server-only helpers for small JSON state files shared by several processes on one host.
 * - writeFileAtomic: temp file + rename, so a crash mid-write never leaves a torn file.
 * - withFileLock: O_EXCL lock file around a synchronous read-modify-write (no awaits inside).
 * Never deletes data files; only the lock file it created (or a stale one) is removed.
 */
import { closeSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync, fsyncSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export class FileLockTimeoutError extends Error {
  constructor(path: string) {
    super(`Timed out waiting for state file lock: ${path}`);
    this.name = "FileLockTimeoutError";
  }
}

export class CorruptStateFileError extends Error {
  constructor(path: string) {
    super(`State file is unreadable or corrupt (refusing to overwrite): ${path}`);
    this.name = "CorruptStateFileError";
  }
}

export function writeFileAtomic(filePath: string, data: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, data, null, "utf8");
    try {
      fsyncSync(fd);
    } catch {
      /* best effort */
    }
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, filePath);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

const sleepCell = typeof SharedArrayBuffer === "function" ? new Int32Array(new SharedArrayBuffer(4)) : null;
function sleepSync(ms: number) {
  if (sleepCell) {
    Atomics.wait(sleepCell, 0, 0, ms);
    return;
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

export type FileLockOptions = { lockTimeoutMs?: number; staleLockMs?: number };

export const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
export const DEFAULT_STALE_LOCK_MS = 10_000;

/** Run `fn` while holding `${filePath}.lock`. `fn` must be synchronous. Throws FileLockTimeoutError. */
export function withFileLock<T>(filePath: string, fn: () => T, options: FileLockOptions = {}): T {
  const lockPath = `${filePath}.lock`;
  const timeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  mkdirSync(dirname(filePath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let fd: number | null = null;
  while (fd === null) {
    try {
      fd = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age > staleMs) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue; // lock vanished between open and stat — retry immediately
      }
      if (Date.now() >= deadline) throw new FileLockTimeoutError(filePath);
      sleepSync(5);
    }
  }
  try {
    writeSync(fd, String(process.pid));
  } catch {
    /* ignore */
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}
