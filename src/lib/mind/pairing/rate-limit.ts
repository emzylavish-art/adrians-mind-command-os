import { pruneStore, readPairingStore, writePairingStore } from "./store.ts";

export const HANDSHAKE_MAX_FAILURES = 8;
export const HANDSHAKE_WINDOW_MS = 15 * 60 * 1000;
export const CODE_MINT_MAX_PER_USER = 5;
export const CODE_MINT_WINDOW_MS = 15 * 60 * 1000;

export function recordHandshakeAttempt(key: string, ok: boolean, now = Date.now()) {
  const store = pruneStore(readPairingStore(), now);
  store.handshakeAttempts.push({ key, at: new Date(now).toISOString(), ok });
  writePairingStore(store);
}

export function handshakeRateLimited(key: string, now = Date.now()): { limited: boolean; remaining: number } {
  const store = pruneStore(readPairingStore(), now);
  const windowStart = now - HANDSHAKE_WINDOW_MS;
  const fails = store.handshakeAttempts.filter(
    (a) => a.key === key && !a.ok && Date.parse(a.at) >= windowStart,
  );
  const remaining = Math.max(0, HANDSHAKE_MAX_FAILURES - fails.length);
  return { limited: fails.length >= HANDSHAKE_MAX_FAILURES, remaining };
}

export function mintRateLimited(userId: string, now = Date.now()): { limited: boolean; remaining: number } {
  const store = pruneStore(readPairingStore(), now);
  const windowStart = now - CODE_MINT_WINDOW_MS;
  const recent = store.codes.filter((c) => c.userId === userId && Date.parse(c.createdAt) >= windowStart);
  const remaining = Math.max(0, CODE_MINT_MAX_PER_USER - recent.length);
  return { limited: recent.length >= CODE_MINT_MAX_PER_USER, remaining };
}
