export type StoredSession = { id: string; token: string; userId: string; createdAt: Date | string; updatedAt: Date | string; expiresAt: Date | string; userAgent?: string | null };
export function publicSessionRows(sessions: StoredSession[], ownerId: string, currentId?: string) {
  return sessions.filter((row) => row.userId === ownerId).map((row) => ({ id: row.id, current: row.id === currentId, createdAt: String(row.createdAt), lastActiveAt: String(row.updatedAt), expiresAt: String(row.expiresAt), device: (row.userAgent || "Device not reported").slice(0, 220) }));
}
/** Resolve token only inside the server from a fresh list bound to the verified owner. */
export function sessionToRevoke(sessions: StoredSession[], ownerId: string, requestedId: string, currentId?: string) {
  const row = sessions.find((candidate) => candidate.userId === ownerId && candidate.id === requestedId);
  if (!row) return { ok: false as const, error: "This session no longer belongs to the active account. Refresh before trying again." };
  if (row.id === currentId) return { ok: false as const, error: "Use Sign out for the current session so local credentials are cleared too." };
  return { ok: true as const, token: row.token };
}
