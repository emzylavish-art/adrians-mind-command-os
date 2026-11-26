import { getSql } from "../db";
import { applyCorePass } from "./core-runtime";
import { readHaltState } from "./halt.server";
import { snapshotRevision, updateOwnerWorkspace } from "./store";
import type { Workspace } from "./types";
type CoreResult = { ok: false; error: string; conflict?: boolean } | { ok: true; message: string; halted: boolean; active: number; queuedNew: number; browserUnchanged: true; workspace: Workspace; ws: Workspace; revision: string };

/** Browser-triggered and persistent passes share the same owner row lock. */
export async function runDurableCorePassForUser(userId: string, expectedRevision?: string) {
  try {
    const sql = await getSql();
    if (!sql.transaction) return { ok: false as const, error: "Shared worker transactions are unavailable. Nothing ran." };
    const stop = await readHaltState(userId);
    if (stop === "unknown") return { ok: false as const, error: "Emergency-stop state could not be verified. Nothing ran." };
    return await updateOwnerWorkspace<CoreResult>(sql, userId, (workspace, raw) => {
      if (expectedRevision && snapshotRevision(raw) !== expectedRevision) return { result: { ok: false as const, conflict: true, error: "The workspace changed. Synchronize it before running another step." } };
      if (!raw) return { result: { ok: false as const, error: "Save the workspace before running the worker." } };
      const next = applyCorePass({ workspace: { ...workspace, halted: workspace.halted || stop === "on" }, now: new Date().toISOString(), workerId: "browser-request", environment: "browser" });
      return { workspace: next.workspace, result: { ok: true as const, message: next.summary.message, halted: next.summary.halted, active: next.summary.active, queuedNew: next.summary.queuedNew, browserUnchanged: true as const, workspace: next.workspace, ws: next.workspace, revision: snapshotRevision(next.workspace) } };
    });
  } catch {
    return { ok: false as const, error: "The shared workspace transaction could not complete. No result was assumed." };
  }
}
