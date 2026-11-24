import { getSql } from "../db";
import { applyCorePass } from "./core-runtime";
import { haltIsOn } from "./halt.server";
import { readSnapshot, snapshotRevision, writeSnapshot } from "./store";
import { normalizeWorkspace } from "./workspace";

/** Advance the signed-in owner's saved server workspace by one real local pass. */
export async function runDurableCorePassForUser(userId: string) {
  let sql;
  try {
    sql = await getSql();
  } catch {
    return { ok: false as const, error: "The workspace database is not available. Nothing ran." };
  }
  let raw: unknown | null = null;
  try {
    raw = await readSnapshot(sql, userId);
  } catch {
    return { ok: false as const, error: "The saved server workspace could not be read. Nothing ran." };
  }
  if (!raw) {
    return { ok: false as const, error: "No saved server workspace. Nothing ran. The browser copy was not changed." };
  }
  const workspace = normalizeWorkspace(raw);
  const halted = workspace.halted || await haltIsOn(userId);
  const next = applyCorePass({
    workspace: { ...workspace, halted },
    now: new Date().toISOString(),
    workerId: "hosted-worker",
  });
  try {
    if (!await writeSnapshot(sql, userId, next.workspace, snapshotRevision(raw))) {
      return { ok: false as const, error: "The server workspace changed during the pass. The newer copy was kept." };
    }
  } catch {
    return { ok: false as const, error: "The server workspace could not be saved. The pass was not kept." };
  }
  return {
    ok: true as const,
    message: next.summary.message,
    halted: next.summary.halted,
    active: next.summary.active,
    queuedNew: next.summary.queuedNew,
    browserUnchanged: true as const,
  };
}
