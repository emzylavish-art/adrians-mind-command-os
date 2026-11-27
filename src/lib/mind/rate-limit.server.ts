import type { Sql } from "../db.ts";
import { resolveDatabaseUrl } from "../env.server.ts";
import { consumeMindRateLimit, type RateLimitResult } from "./limits.ts";

export type SharedRateLimitResult = RateLimitResult | { ok: false; retryAfterSec: number; unavailable: true };

/** An atomic shared fixed window. A rejected request cannot reset a window or choose another owner. */
export async function consumeSqlRateLimit(sql: Sql, bucket: string, ownerId: string, limit: number, windowMs = 60_000, now = Date.now()): Promise<RateLimitResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1 || !Number.isSafeInteger(now)) {
    return { ok: false, retryAfterSec: 60 };
  }
  const rows = await sql.query<{ request_count: number; window_started_ms: number | string }>(
    "INSERT INTO mind_rate_window(owner_id,bucket,window_ms,window_started_ms,request_count) VALUES($1,$2,$3,$4,1) " +
    "ON CONFLICT(owner_id,bucket,window_ms) DO UPDATE SET " +
    "window_started_ms=CASE WHEN mind_rate_window.window_started_ms+$3<=$4 THEN $4 ELSE mind_rate_window.window_started_ms END, " +
    "request_count=CASE WHEN mind_rate_window.window_started_ms+$3<=$4 THEN 1 ELSE least(mind_rate_window.request_count+1,2147483646) END " +
    "RETURNING request_count,window_started_ms", [ownerId, bucket, windowMs, now]);
  const row = rows[0];
  if (!row) throw new Error("Rate limit storage did not return a window.");
  return row.request_count <= limit ? { ok: true } : { ok: false, retryAfterSec: Math.max(1, Math.ceil((Number(row.window_started_ms) + windowMs - now) / 1000)) };
}

/** Production requires shared storage; local development keeps the bounded in-process fixture path. */
export async function consumeSharedMindRateLimit(bucket: string, ownerId: string, limit: number, windowMs = 60_000, now = Date.now()): Promise<SharedRateLimitResult> {
  const configured = Boolean(resolveDatabaseUrl());
  if (!configured && !process.env.VERCEL && !process.env.GROK_PROJECT_ID) return consumeMindRateLimit(bucket, ownerId, limit, windowMs, now);
  if (!configured) return { ok: false, retryAfterSec: 60, unavailable: true };
  try {
    const { getSql } = await import("../db.ts");
    return await consumeSqlRateLimit(await getSql(), bucket, ownerId, limit, windowMs, now);
  } catch {
    return { ok: false, retryAfterSec: 60, unavailable: true };
  }
}

export async function allowSharedMindRequest(bucket: string, ownerId: string, limit: number, windowMs = 60_000): Promise<boolean> {
  return (await consumeSharedMindRateLimit(bucket, ownerId, limit, windowMs)).ok;
}
