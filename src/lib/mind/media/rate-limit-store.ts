/**
 * Server-only file-backed Imagine rate-limit store (multi-process on one host).
 *
 * Multi-host / edge: keep `ImagineRateLimitStore` pluggable. A Redis (or similar)
 * implementation belongs to infra/integration — this lane will call
 * `setImagineRateLimitStore(...)` once that backend exists. Until then, file + memory
 * only protect a single machine.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { ImagineRateLimitStore } from "./harden.ts";

export type { ImagineRateLimitStore };

export function createFileRateLimitStore(filePath: string): ImagineRateLimitStore {
  function readAll(): Record<string, number[]> {
    try {
      if (!existsSync(filePath)) return {};
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, number[]>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  function writeAll(data: Record<string, number[]>) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data), "utf8");
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

export const DEFAULT_IMAGINE_RATE_LIMIT_PATH = ".data/media-imagine-rate-limit.json";
