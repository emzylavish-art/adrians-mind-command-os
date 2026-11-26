import { resolveDatabaseUrl } from "../env.server.ts";
import { readHaltFile, writeHaltFile } from "./halt-file.ts";

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

export async function setDurableHalt(userId: string, on: boolean): Promise<{ ok: true; halted: boolean; cancellation?: { cancelled: number; pending: number; unknown: number } } | { ok: false; error: string }> {
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
    let cancellation;
    if (on) {
      try {
        const { cancelOwnerJobs } = await import("./pc-pairing/store.ts");
        cancellation = cancelOwnerJobs(userId);
      } catch { cancellation = { cancelled: 0, pending: 0, unknown: 1 }; }
    }
    return { ok: true, halted: on, cancellation };
  } catch {
    return { ok: false, error: "The emergency stop could not be saved. Check storage and retry." };
  }
}
