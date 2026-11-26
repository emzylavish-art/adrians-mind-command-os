import { createHash } from "node:crypto";
import type { Sql } from "../db.ts";

export type NotionWriteOutcome = "sending" | "accepted" | "verified" | "rejected" | "unknown";
export type NotionWriteReceipt = {
  fingerprint: string;
  pageId: string;
  outcome: NotionWriteOutcome;
  blockIds: string[];
};
export type NotionReceiptStore = {
  read(id: string): Promise<NotionWriteReceipt | null>;
  claim(id: string, receipt: NotionWriteReceipt): Promise<boolean>;
  save(id: string, receipt: NotionWriteReceipt): Promise<void>;
};

export function validNotionOperationId(id: unknown): id is string {
  return typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
}

export function notionWriteFingerprint(workspaceId: string, pageId: string, note: string): string {
  return createHash("sha256").update(JSON.stringify([workspaceId, pageId, note])).digest("hex");
}

/** Owner-scoped, durable receipts reuse the existing tool-run table. No secret or note is stored. */
export function notionReceiptStore(sql: Sql, ownerId: string): NotionReceiptStore {
  const key = (id: string) => `notion-write:${id}`;
  return {
    async read(id) {
      const [row] = await sql<{ detail: string }>`select detail from mind_tool_run where user_id = ${ownerId} and id = ${key(id)} and tool = 'notion-write'`;
      if (!row) return null;
      const value: unknown = JSON.parse(row.detail);
      if (!value || typeof value !== "object") throw new Error("The saved Notion receipt could not be read.");
      const receipt = value as NotionWriteReceipt;
      if (!/^[a-f0-9]{64}$/.test(receipt.fingerprint) || typeof receipt.pageId !== "string" || !Array.isArray(receipt.blockIds) ||
        !receipt.blockIds.every((id) => typeof id === "string") || !["sending", "accepted", "verified", "rejected", "unknown"].includes(receipt.outcome)) {
        throw new Error("The saved Notion receipt could not be read.");
      }
      return receipt;
    },
    async claim(id, receipt) {
      const inserted = await sql<{ id: string }>`insert into mind_tool_run (user_id, id, tool, action, ok, detail)
        values (${ownerId}, ${key(id)}, 'notion-write', 'append', false, ${JSON.stringify(receipt)})
        on conflict (user_id, id) do nothing returning id`;
      return inserted.length === 1;
    },
    async save(id, receipt) {
      await sql`update mind_tool_run set detail = ${JSON.stringify(receipt)}, ok = ${receipt.outcome === "verified"}
        where user_id = ${ownerId} and id = ${key(id)} and tool = 'notion-write'`;
    },
  };
}
