import { createHash } from "node:crypto";
import type { Sql } from "../../db.ts";
import { ACCOUNT_ATTACHMENT_ID, MAX_ATTACHMENT_DATA_CHARS } from "./attachment-integrity.ts";

export async function putAccountAttachment(sql: Sql, userId: string, dataUrl: string) {
  if (!userId || !/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=\r\n]+$/.test(dataUrl) || dataUrl.length >= MAX_ATTACHMENT_DATA_CHARS) {
    return { ok: false as const, error: "This image cannot be saved to account storage. Its bytes remain on this device." };
  }
  const id = `acct_${createHash("sha256").update(dataUrl).digest("hex")}`;
  await sql`insert into mind_account_attachment (user_id, id, data_url) values (${userId}, ${id}, ${dataUrl}) on conflict (user_id, id) do nothing`;
  const saved = await getAccountAttachment(sql, userId, id);
  if (saved !== dataUrl) return { ok: false as const, error: "The attachment write could not be verified. Its bytes remain on this device." };
  return { ok: true as const, id };
}

export async function getAccountAttachment(sql: Sql, userId: string, id: string): Promise<string | undefined> {
  if (!userId || !ACCOUNT_ATTACHMENT_ID.test(id)) return undefined;
  const rows = await sql<{ data_url: string }>`select data_url from mind_account_attachment where user_id = ${userId} and id = ${id}`;
  return rows[0]?.data_url;
}
