export const NOTIFICATION_MARK_LIMIT = 5000;
export const NOTIFICATION_MARK_BATCH = 500;
export type NotificationMark = { key: string; visibility: 1 | 2 };
const hashPattern = /^[0-9a-f]{64}$/;

export function readNotificationMarks(input: unknown, limit: number): NotificationMark[] | null {
  if (!Array.isArray(input) || input.length > limit) return null;
  const combined = new Map<string, NotificationMark["visibility"]>();
  for (const row of input) {
    if (!row || typeof row.key !== "string" || !hashPattern.test(row.key) || (row.visibility !== 1 && row.visibility !== 2)) return null;
    combined.set(row.key, row.visibility === 2 || combined.get(row.key) === 2 ? 2 : 1);
  }
  return [...combined].map(([key, visibility]) => ({ key, visibility }));
}

export async function notificationKey(id: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
