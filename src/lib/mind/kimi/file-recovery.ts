import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Restore only absent files. A stale saved copy must never replace unpersisted local work during Browse. */
export function restoreMissingWorkspaceFile(root: string, path: string, content: string): boolean {
  const target = resolve(root, path);
  const base = resolve(root);
  if (target === base || !target.startsWith(`${base}/`) || existsSync(target)) return false;
  mkdirSync(dirname(target), { recursive: true });
  try { writeFileSync(target, content, { flag: "wx" }); return true; }
  catch (error) { if ((error as { code?: string }).code === "EEXIST") return false; throw error; }
}
