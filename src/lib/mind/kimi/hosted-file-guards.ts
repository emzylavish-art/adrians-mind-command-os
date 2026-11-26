import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { join, relative } from "node:path";

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function fileRevision(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function safeWorkspaceFile(root: string, target: string): boolean {
  if (!inside(root, target)) return false;
  const relativePath = relative(root, target);
  let current = root;
  for (const part of relativePath.split("/").filter(Boolean)) {
    current = join(current, part);
    const entry = lstatSync(current, { throwIfNoEntry: false });
    if (!entry) break;
    if (entry.isSymbolicLink()) return false;
  }
  return true;
}

export function plainFile(path: string): boolean {
  return Boolean(lstatSync(path, { throwIfNoEntry: false })?.isFile());
}
