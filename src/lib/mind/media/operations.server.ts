import { createHash } from "node:crypto";
import type { Sql } from "../../db.ts";

export type MediaOperation = {
  id: string; kind: "image" | "video"; payloadHash: string; chatId: string | null;
  state: "dispatching" | "pending" | "completed" | "failed" | "unknown";
  result: Record<string, unknown> | null;
  retainResult?: boolean;
};
export interface MediaOperationStore {
  claim(owner: string, operation: MediaOperation): Promise<boolean>;
  get(owner: string, id: string): Promise<MediaOperation | null>;
  list(owner: string): Promise<MediaOperation[]>;
  save(owner: string, operation: MediaOperation): Promise<void>;
}
export const validMediaOperationId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{8,100}$/.test(id);
export function mediaPayloadHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function memoryMediaOperations(): MediaOperationStore {
  const rows = new Map<string, MediaOperation>();
  const key = (owner: string, id: string) => JSON.stringify([owner, id]);
  return {
    async claim(owner, operation) { const id = key(owner, operation.id); if (rows.has(id)) return false; rows.set(id, structuredClone(operation)); return true; },
    async get(owner, id) { return structuredClone(rows.get(key(owner, id)) ?? null); },
    async list(owner) { return [...rows.entries()].filter(([id]) => JSON.parse(id)[0] === owner).map(([, row]) => structuredClone(row)); },
    async save(owner, operation) { if (!rows.has(key(owner, operation.id))) throw new Error("Operation not found"); rows.set(key(owner, operation.id), structuredClone(operation)); },
  };
}
type Row = { id: string; kind: "image" | "video"; payload_hash: string; chat_id: string | null; state: MediaOperation["state"]; result_json: MediaOperation["result"] };
const decode = (row: Row): MediaOperation => ({ id: row.id, kind: row.kind, payloadHash: row.payload_hash, chatId: row.chat_id, state: row.state, result: row.result_json });
export function sqlMediaOperations(sql: Sql): MediaOperationStore {
  return {
    async claim(owner, op) {
      const rows = await sql`insert into mind_media_operations (owner_id,id,kind,payload_hash,chat_id) values (${owner},${op.id},${op.kind},${op.payloadHash},${op.chatId}) on conflict do nothing returning id`;
      return rows.length === 1;
    },
    async get(owner, id) { const rows = await sql<Row>`select * from mind_media_operations where owner_id=${owner} and id=${id}`; return rows[0] ? decode(rows[0]) : null; },
    async list(owner) { return (await sql<Row>`select * from mind_media_operations where owner_id=${owner} order by created_at desc limit 100`).map(decode); },
    async save(owner, op) { await sql`update mind_media_operations set state=${op.state},result_json=${JSON.stringify(op.result)}::jsonb,updated_at=now() where owner_id=${owner} and id=${op.id}`; },
  };
}
export async function durableMediaOperations(): Promise<MediaOperationStore> {
  const { getSql, dbSource } = await import("../../db.ts");
  if (process.env.VERCEL && dbSource === "pglite") throw new Error("Durable media recovery storage is unavailable.");
  return sqlMediaOperations(await getSql());
}

/** Atomic reservation prevents re-billing after a lost response. Never repeat an uncertain dispatch. */
export async function runMediaOnce(store: MediaOperationStore, owner: string, op: MediaOperation, dispatch: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  if (!await store.claim(owner, op)) {
    const saved = await store.get(owner, op.id);
    if (!saved || saved.payloadHash !== op.payloadHash) return { ok: false, code: "operation_conflict", status: 409, error: "This operation ID belongs to a different media request." };
    return saved.result ? { ...saved.result, operationId: op.id, recovered: true } : { ok: false, code: "outcome_unknown", status: 409, operationId: op.id, error: "The previous request may have reached the provider. Inspect its saved operation; do not generate it again automatically." };
  }
  let result: Record<string, unknown>;
  try { result = await dispatch(); }
  catch { result = { ok: false, code: "outcome_unknown", status: 502, error: "The media request lost confirmation. Its outcome is unknown; it was not sent again." }; }
  op.state = result.ok === true ? result.state === "pending" ? "pending" : "completed" : result.dispatched !== false && (result.code === "outcome_unknown" || Number(result.status) >= 500) ? "unknown" : "failed";
  const receipt = { provider: "xAI", kind: op.kind, outcome: op.state, retention: op.retainResult === false ? "temporary_not_retained" : op.kind === "video" ? "provider_url_expires" : "account_result", cost: result.dispatched === false ? "not-dispatched" : "unreconciled" };
  const returned = { ...result, operationId: op.id, receipt };
  op.result = op.retainResult === false && op.kind === "video" && result.state === "pending" ? { ok: true, state: "pending", requestId: result.requestId, operationId: op.id, receipt }
    : op.retainResult === false ? { ok: false, code: "temporary_result_not_retained", status: 409, operationId: op.id, receipt,
    error: "Temporary conversation media is not retained for recovery. No generation was repeated." } : returned;
  await store.save(owner, op);
  return returned;
}
