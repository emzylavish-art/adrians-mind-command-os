import { getSql } from "../db.ts";

export type Receipt = {
  id: string;
  state: "PROPOSED" | "EXECUTED";
  action: string;
  detail: string;
  createdAt: string;
};

async function ensureReceiptTable() {
  const sql = await getSql();
  await sql.query(`create table if not exists mind_receipt (
    id text primary key,
    user_id text not null,
    state text not null,
    action text not null,
    detail text not null default '',
    created_at timestamptz not null default now()
  )`);
  return sql;
}

export async function recordReceipt(userId: string, input: { state: Receipt["state"]; action: string; detail: string }): Promise<Receipt> {
  const sql = await ensureReceiptTable();
  const receipt: Receipt = {
    id: crypto.randomUUID(),
    state: input.state,
    action: input.action.replace(/\s+/g, " ").trim().slice(0, 80),
    detail: input.detail.replace(/\s+/g, " ").trim().slice(0, 240),
    createdAt: new Date().toISOString(),
  };
  await sql.query(
    "insert into mind_receipt (id, user_id, state, action, detail, created_at) values ($1, $2, $3, $4, $5, $6)",
    [receipt.id, userId, receipt.state, receipt.action, receipt.detail, receipt.createdAt],
  );
  return receipt;
}

export async function listReceipts(userId: string): Promise<Receipt[]> {
  const sql = await ensureReceiptTable();
  const rows = await sql.query<{ id: string; state: string; action: string; detail: string; created_at: string | Date }>(
    "select id, state, action, detail, created_at from mind_receipt where user_id = $1 order by created_at desc limit 8",
    [userId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    state: row.state === "EXECUTED" ? "EXECUTED" : "PROPOSED",
    action: String(row.action),
    detail: String(row.detail),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}
