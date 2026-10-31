import { getSql } from "../db";
import { canChangeHalt } from "./halt-policy";
import { readHaltFile, writeHaltFile } from "./halt-file";
import { readControl, writeControl } from "./store";

export async function haltIsOn(userId: string): Promise<boolean> {
  const file = readHaltFile(userId);
  if (file.ownerId) return file.halted;
  try {
    return await readControl(await getSql(), userId);
  } catch {
    return false;
  }
}

export async function setDurableHalt(userId: string, on: boolean): Promise<{ ok: true; halted: boolean } | { ok: false; error: string }> {
  const current = readHaltFile(userId);
  const decision = canChangeHalt(userId, current.ownerId, !on);
  if (!decision.ok) return decision;
  try {
    await writeControl(await getSql(), userId, on);
  } catch {
    /* a missing database must not trap the stop */
  }
  writeHaltFile(userId, on);
  return { ok: true, halted: on };
}
