/** Non-secret login-instance identity. Refreshing a token is not a new login. */
export function sessionInstanceId(session: unknown): string | null {
  if (!session || typeof session !== "object" || Array.isArray(session)) return null;
  const row = session as Record<string, unknown>;
  if (typeof row.id === "string" && row.id.length > 0 && row.id.length <= 300) return `session:${row.id}`;
  // Some compatible clients omit the session ID but retain its immutable creation time.
  const created = row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt;
  return typeof created === "string" && Number.isFinite(Date.parse(created)) ? `created:${new Date(created).toISOString()}` : null;
}
