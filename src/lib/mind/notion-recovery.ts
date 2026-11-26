export type NotionRecovery = {
  operationId: string; owner: string; chatId: string; workspaceId: string; pageId: string;
  text: string; state: "sending" | "accepted" | "unknown"; pageUrl?: string;
};
export function notionRecoveryKey(owner: string) { return `amcos.notion.recovery.v1:${encodeURIComponent(owner)}`; }
export function loadNotionRecovery(owner: string | null, storage: Pick<Storage, "getItem">): NotionRecovery[] {
  if (!owner) return [];
  try {
    const rows: unknown = JSON.parse(storage.getItem(notionRecoveryKey(owner)) ?? "[]");
    return Array.isArray(rows) ? rows.filter((row): row is NotionRecovery => Boolean(row && typeof row === "object" && row.owner === owner &&
      /^[a-f0-9-]{36}$/i.test(row.operationId) && typeof row.chatId === "string" && typeof row.workspaceId === "string" && typeof row.pageId === "string" && typeof row.text === "string")) : [];
  } catch { return []; }
}
export function saveNotionRecovery(owner: string, rows: NotionRecovery[], storage: Pick<Storage, "setItem">): boolean {
  try { storage.setItem(notionRecoveryKey(owner), JSON.stringify(rows.filter((row) => row.owner === owner))); return true; }
  catch { return false; }
}
