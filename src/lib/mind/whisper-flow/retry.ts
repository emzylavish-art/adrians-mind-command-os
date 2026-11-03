/** Exponential backoff for failed Whisper Flow STT chunks. */

import { WHISPER_FLOW_MAX_RETRIES } from "./types.ts";

export type RetryPlan = {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  shouldRetry: boolean;
};

export function nextRetryPlan(
  attempt: number,
  options?: { maxAttempts?: number; baseMs?: number; maxMs?: number },
): RetryPlan {
  const maxAttempts = options?.maxAttempts ?? WHISPER_FLOW_MAX_RETRIES;
  const baseMs = options?.baseMs ?? 400;
  const maxMs = options?.maxMs ?? 4000;
  const nextAttempt = Math.max(0, attempt) + 1;
  const shouldRetry = nextAttempt <= maxAttempts;
  const delayMs = shouldRetry
    ? Math.min(maxMs, baseMs * 2 ** Math.max(0, nextAttempt - 1))
    : 0;
  return { attempt: nextAttempt, maxAttempts, delayMs, shouldRetry };
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Retry an async operation with backoff. Keeps the same payload across attempts.
 * Returns the first ok result or the last failure.
 */
export async function withBackoffRetry<T extends { ok: boolean }>(
  run: (attempt: number) => Promise<T>,
  options?: {
    maxAttempts?: number;
    baseMs?: number;
    maxMs?: number;
    signal?: AbortSignal;
    isRetryable?: (result: T) => boolean;
  },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? WHISPER_FLOW_MAX_RETRIES;
  let last: T | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    last = await run(attempt);
    if (last.ok) return last;
    const retryable = options?.isRetryable ? options.isRetryable(last) : true;
    if (!retryable || attempt >= maxAttempts) return last;
    const plan = nextRetryPlan(attempt, {
      maxAttempts,
      baseMs: options?.baseMs,
      maxMs: options?.maxMs,
    });
    // nextRetryPlan treats `attempt` as previous; we already incremented — use delay from plan for this failed attempt index
    const delay = Math.min(options?.maxMs ?? 4000, (options?.baseMs ?? 400) * 2 ** (attempt - 1));
    void plan;
    await sleep(delay, options?.signal);
  }
  return last as T;
}

export function isTransientSttError(message: string): boolean {
  return /timed? out|did not answer|network|fetch|502|503|504|429|temporar/i.test(message);
}
