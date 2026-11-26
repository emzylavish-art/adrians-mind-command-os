/** OAuth expires_in is a numeric duration; null, booleans and empty strings are not expirations. */
export function tokenExpiresAt(value: unknown, now = Date.now()): string | undefined {
  const seconds = typeof value === "number" ? value : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 366 * 24 * 60 * 60 ? new Date(now + seconds * 1000).toISOString() : undefined;
}
