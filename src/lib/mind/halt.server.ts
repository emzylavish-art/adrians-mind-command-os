import { resolveDatabaseUrl } from "../env.server.ts";
import { createHash, randomUUID } from "node:crypto";
import { readHaltFile, writeHaltFile, haltFileRevision } from "./halt-file.ts";
import { cancelOwnerBuildJobs, type BuildCancellationSummary } from "./pc-pairing/store.ts";
import type { Sql } from "../db.ts";

export type HaltSnapshot = { state: "on" | "off" | "unknown"; revision: string | null };
function controlRevision(row?: { halted: boolean; stamp: string }): string {
  return row ? createHash("sha256").update(JSON.stringify([row.halted, row.stamp])).digest("hex") : "missing";
}
export async function readSharedHalt(sql: Sql, userId: string): Promise<HaltSnapshot> {
  const [row] = await sql.query<{ halted: boolean; stamp: string }>("select halted, updated_at::text as stamp from mind_control where user_id=$1", [userId]);
  return { state: row?.halted ? "on" : "off", revision: controlRevision(row) };
}
export async function updateSharedHalt(sql: Sql, userId: string, on: boolean, expectedRevision?: string): Promise<void> {
  if (typeof on !== "boolean") throw new Error("Emergency stop requires an explicit boolean.");
  if (!sql.transaction) throw new Error("Atomic emergency control is unavailable.");
  await sql.transaction(async (tx) => {
    // The unique owner row serializes first-use races as well as existing controls.
    const inserted = await tx.query("insert into mind_control(user_id,halted) values($1,false) on conflict do nothing returning user_id", [userId]);
    const [row] = await tx.query<{ halted: boolean; stamp: string }>("select halted, updated_at::text as stamp from mind_control where user_id=$1 for update", [userId]);
    const previousRevision = inserted.length ? "missing" : controlRevision(row);
    if (!on && expectedRevision !== undefined && expectedRevision !== previousRevision) throw new Error("Emergency stop changed elsewhere. Reload its state before resuming.");
    await tx.query("insert into mind_control(user_id,halted,updated_at) values($1,$2,clock_timestamp()) on conflict(user_id) do update set halted=excluded.halted,updated_at=clock_timestamp()", [userId, on]);
    await tx.query("insert into mind_audit(user_id,id,at,action,target,result) values($1,$2,now(),'emergency_control','account',$3)", [userId, randomUUID(), JSON.stringify({ halted: on, previousRevision })]);
  });
}

function sharedStorageRequired() {
  return Boolean(resolveDatabaseUrl() || process.env.VERCEL || process.env.GROK_PROJECT_ID);
}

async function sharedSql() {
  // A deployed instance without its database must never substitute embedded storage.
  if (!resolveDatabaseUrl()) throw new Error("Shared stop storage is unavailable.");
  const { getSql } = await import("../db.ts");
  return getSql();
}

export async function readHaltState(userId: string): Promise<"on" | "off" | "unknown"> {
  if (!userId) return "unknown";
  try {
    if (!sharedStorageRequired()) return readHaltFile(userId).halted ? "on" : "off";
    const sql = await sharedSql();
    const { readControl } = await import("./store.ts");
    const halted = await readControl(sql, userId);
    return halted ? "on" : "off";
  } catch {
    return "unknown";
  }
}

export async function readHaltSnapshot(userId: string): Promise<HaltSnapshot> {
  if (!userId) return { state: "unknown", revision: null };
  try {
    if (sharedStorageRequired()) return await readSharedHalt(await sharedSql(), userId);
    const revision = haltFileRevision(userId);
    try { return { state: readHaltFile(userId).halted ? "on" : "off", revision }; }
    catch { return { state: "unknown", revision }; }
  } catch { return { state: "unknown", revision: null }; }
}

// Effectful callers must wait until the authoritative state is explicitly off.
export async function haltIsOn(userId: string): Promise<boolean> {
  return (await readHaltState(userId)) !== "off";
}

type HaltSaveResult = { ok: true; halted: boolean; buildCancellation?: BuildCancellationSummary } | { ok: false; error: string };
const haltWrites = new Map<string, Promise<HaltSaveResult>>();

export async function setDurableHalt(userId: string, on: boolean, expectedRevision?: string): Promise<{ ok: true; halted: boolean } | { ok: false; error: string }> {
  if (!userId) return { ok: false, error: "Sign in is required." };
  if (typeof on !== "boolean") return { ok: false, error: "Emergency stop requires an explicit boolean. Existing state was preserved." };
  try {
    if (sharedStorageRequired()) {
      const sql = await sharedSql();
      await updateSharedHalt(sql, userId, on, expectedRevision);
    } else {
      // File names are scoped to the authenticated owner, including when repairing corrupt state.
      if (!on && expectedRevision !== undefined && expectedRevision !== haltFileRevision(userId)) return { ok: false, error: "Emergency stop changed elsewhere. Reload its state before resuming." };
      writeHaltFile(userId, on);
    }
    return { ok: true, halted: on };
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.message.includes("changed elsewhere") ? error.message : "The emergency stop could not be saved. Check storage and retry." };
  }
}

async function applyDurableHalt(userId: string, on: boolean): Promise<HaltSaveResult> {
  if (!userId) return { ok: false, error: "Sign in is required." };
  try {
    if (sharedStorageRequired()) {
      const sql = await sharedSql();
      const { writeControl } = await import("./store.ts");
      await writeControl(sql, userId, on);
    } else {
      // File names are scoped to the authenticated owner, including when repairing corrupt state.
      writeHaltFile(userId, on);
    }
    if (on) {
      let buildCancellation: BuildCancellationSummary;
      try { buildCancellation = cancelOwnerBuildJobs(userId); }
      catch { buildCancellation = { queuedCancelled: 0, cancellationRequested: 0, unconfirmed: 1 }; }
      return { ok: true, halted: on, buildCancellation };
    }
    return { ok: true, halted: on };
  } catch {
    return { ok: false, error: "The emergency stop could not be saved. Check storage and retry." };
  }
}
