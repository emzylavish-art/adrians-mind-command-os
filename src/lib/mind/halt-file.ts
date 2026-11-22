import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localDataPath } from "../local-data.ts";

let directory = localDataPath("mind-halt");

export function setHaltDirectory(next: string) {
  directory = next;
}

function fileFor(userId: string) {
  return join(directory, `${createHash("sha256").update(userId).digest("hex")}.json`);
}

export function readHaltFile(userId: string): { halted: boolean; ownerId: string | null } {
  try {
    const parsed = JSON.parse(readFileSync(fileFor(userId), "utf8")) as { halted?: boolean; ownerId?: string };
    return { halted: parsed.halted === true, ownerId: typeof parsed.ownerId === "string" ? parsed.ownerId : null };
  } catch {
    return { halted: false, ownerId: null };
  }
}

export function writeHaltFile(userId: string, halted: boolean) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(fileFor(userId), JSON.stringify({ halted, ownerId: userId }));
}
