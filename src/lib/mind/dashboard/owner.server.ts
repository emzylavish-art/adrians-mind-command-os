/** Server-only owner authorization. Missing configuration deliberately denies access. */
export function isMindOwnerId(
  userId: string | null | undefined,
  configuredOwnerId: string | undefined = process.env.MIND_OWNER_USER_ID,
): boolean {
  if (typeof userId !== "string" || userId.length === 0) return false;
  if (typeof configuredOwnerId !== "string" || configuredOwnerId.trim().length === 0) return false;
  return userId === configuredOwnerId.trim();
}
