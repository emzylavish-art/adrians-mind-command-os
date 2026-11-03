/**
 * Server-only file-backed Imagine rate-limit store (multi-process on one host).
 *
 * Read-modify-write runs under an O_EXCL lock file and writes via temp + rename, so
 * concurrent processes share one window and a crash cannot leave a torn file.
 * Corrupt/unreadable JSON throws (checkImagineRateLimit then fails closed) and the
 * file is never overwritten.
 *
 * Multi-host / edge: keep `ImagineRateLimitStore` pluggable. A Redis (or similar)
 * implementation belongs to infra/integration — this lane will call
 * `setImagineRateLimitStore(...)` once that backend exists. Until then, file + memory
 * only protect a single machine.
 */
import { existsSync, readFileSync } from "node:fs";
import { IMAGINE_WINDOW_MS, type ImagineRateLimitStore } from "./harden.ts";
import { CorruptStateFileError, writeFileAtomic, withFileLock, type FileLockOptions } from "./file-atomic.ts";

export type { ImagineRateLimitStore };

export function createFileRateLimitStore(filePath: string, lockOptions: FileLockOptions = {}): ImagineRateLimitStore {
  function readAll(): Record<string, number[]> {
    if (!existsSync(filePath)) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      throw new CorruptStateFileError(filePath);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CorruptStateFileError(filePath);
    return parsed as Record<string, number[]>;
  }
  function writeAll(data: Record<string, number[]>) {
    // Drop keys whose window has fully expired so the file stays small.
    const cutoff = Date.now() - IMAGINE_WINDOW_MS * 2;
    for (const [k, hits] of Object.entries(data)) {
      if (!Array.isArray(hits) || hits.every((t) => typeof t !== "number" || t < cutoff)) delete data[k];
    }
    writeFileAtomic(filePath, JSON.stringify(data));
  }
  function hitsOf(all: Record<string, number[]>, key: string): number[] {
    const raw = all[key];
    return Array.isArray(raw) ? raw.filter((t) => typeof t === "number") : [];
  }
  return {
    get(key) {
      return hitsOf(readAll(), key);
    },
    set(key, hits) {
      withFileLock(
        filePath,
        () => {
          const all = readAll();
          all[key] = [...hits];
          writeAll(all);
        },
        lockOptions,
      );
    },
    update(key, fn) {
      return withFileLock(
        filePath,
        () => {
          const all = readAll();
          const out = fn(hitsOf(all, key));
          if (out.hits) {
            all[key] = [...out.hits];
            writeAll(all);
          }
          return out.result;
        },
        lockOptions,
      );
    },
  };
}

export const DEFAULT_IMAGINE_RATE_LIMIT_PATH = ".data/media-imagine-rate-limit.json";
