import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localDataPath } from "../local-data.ts";

let directory = localDataPath("mind-halt");

export function setHaltDirectory(next: string) {
  directory = next;
}

function fileFor(userId: string) {
  return join(directory, `${createHash("sha256").update(userId).digest("hex")}.json`);
}

/** Opaque revision also exists for corrupt files, allowing explicit owner repair without a stale resume. */
export function haltFileRevision(userId: string): string {
  try { return createHash("sha256").update(readFileSync(fileFor(userId))).digest("hex"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
}

export function readHaltFile(userId: string): { halted: boolean; ownerId: string | null } {
  try {
    const parsed = JSON.parse(readFileSync(fileFor(userId), "utf8")) as { halted?: boolean; ownerId?: string };
    if (parsed?.ownerId !== userId || typeof parsed.halted !== "boolean") {
      throw new Error("Unreadable emergency stop state.");
    }
    return { halted: parsed.halted, ownerId: userId };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { halted: false, ownerId: null };
    throw error;
  }
}

export function writeHaltFile(userId: string, halted: boolean) {
  mkdirSync(directory, { recursive: true });
  const target = fileFor(userId);
  const temporary = target + "." + randomUUID() + ".tmp";
  let changes: unknown[] = [];
  try { const previous = JSON.parse(readFileSync(target, "utf8")); if (previous.ownerId === userId && Array.isArray(previous.changes)) changes = previous.changes.slice(-49); } catch { /* Explicit owner repair preserves an unknown prior state. */ }
  try {
    writeFileSync(temporary, JSON.stringify({ halted, ownerId: userId, changes: [...changes, { id: randomUUID(), at: new Date().toISOString(), halted }] }), { mode: 0o600 });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
