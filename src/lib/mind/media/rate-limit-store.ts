/**
 * Server-only file-backed Imagine rate-limit store (multi-process on one host).
 *
 * Multi-host / edge: keep `ImagineRateLimitStore` pluggable. A Redis (or similar)
 * implementation belongs to infra/integration — this lane will call
 * `setImagineRateLimitStore(...)` once that backend exists. Until then, file + memory
 * only protect a single machine.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ImagineRateLimitStore } from "./harden.ts";

export type { ImagineRateLimitStore };

export function createFileRateLimitStore(filePath: string): ImagineRateLimitStore {
  let fallback: Record<string, number[]> = {};

  function readAll(): Record<string, number[]> {
    try {
      if (!existsSync(filePath)) return fallback;
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, number[]>;
      if (parsed && typeof parsed === "object") fallback = parsed;
    } catch {
      // A warm server process still enforces its local limit if the filesystem
      // becomes unavailable between requests.
    }
    return fallback;
  }
  function writeAll(data: Record<string, number[]>) {
    fallback = data;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(data), "utf8");
    } catch {
      // Keep the in-process limiter active. Durable daily spend controls remain
      // authoritative and must not be replaced by a filesystem failure.
    }
  }
  return {
    get(key) {
      return [...(readAll()[key] ?? [])];
    },
    set(key, hits) {
      const all = readAll();
      all[key] = [...hits];
      writeAll(all);
    },
  };
}

export const LOCAL_IMAGINE_RATE_LIMIT_PATH = ".data/media-imagine-rate-limit.json";

export function resolveImagineRateLimitPath(
  env: Readonly<{ VERCEL?: string }> = process.env,
  temporaryDirectory = tmpdir(),
): string {
  return env.VERCEL
    ? join(temporaryDirectory, "adrians-mind", "media-imagine-rate-limit.json")
    : LOCAL_IMAGINE_RATE_LIMIT_PATH;
}
