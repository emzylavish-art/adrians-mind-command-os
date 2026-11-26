import { resolveDatabaseUrl } from "../env.server.ts";
import { readHaltFile, writeHaltFile } from "./halt-file.ts";
import { cancelOwnerBuildJobs, type BuildCancellationSummary } from "./pc-pairing/store.ts";

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

// Effectful callers must wait until the authoritative state is explicitly off.
export async function haltIsOn(userId: string): Promise<boolean> {
  return (await readHaltState(userId)) !== "off";
}

type HaltSaveResult = { ok: true; halted: boolean; buildCancellation?: BuildCancellationSummary } | { ok: false; error: string };
const haltWrites = new Map<string, Promise<HaltSaveResult>>();

/** Preserve command order per owner; a delayed enable cannot cancel work after a later clear. */
export function setDurableHalt(userId: string, on: boolean): Promise<HaltSaveResult> {
  const previous = haltWrites.get(userId) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(() => applyDurableHalt(userId, on));
  haltWrites.set(userId, pending);
  void pending.finally(() => { if (haltWrites.get(userId) === pending) haltWrites.delete(userId); });
  return pending;
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
