import { resolve } from "node:path";

const DEFAULT_LOCK_ROOTS = ["/workspace/locks"];
const DEFAULT_REPO_ROOTS = [
  "/workspace/mind-command-os",
  "/workspace/mind-command-os-dashboard",
];

export function resolveAllowedDir(
  requested: string | undefined,
  fallback: string,
  allowedRoots: string[],
): { path: string; rejected?: string } {
  const raw = (requested ?? "").trim() || fallback;
  const resolved = resolve(raw);
  const ok = allowedRoots.some((root) => {
    const r = resolve(root);
    return resolved === r || resolved.startsWith(r + "/");
  });
  if (!ok) {
    return { path: resolve(fallback), rejected: `Rejected path outside allowlist: ${raw}` };
  }
  return { path: resolved };
}

export function locksDirFromEnvSafe(env: NodeJS.ProcessEnv = process.env): {
  path: string;
  rejected?: string;
} {
  return resolveAllowedDir(env.MIND_LOCKS_DIR, "/workspace/locks", DEFAULT_LOCK_ROOTS);
}

export function repoDirFromEnvSafe(env: NodeJS.ProcessEnv = process.env): {
  path: string;
  rejected?: string;
} {
  return resolveAllowedDir(env.MIND_REPO_DIR, "/workspace/mind-command-os", DEFAULT_REPO_ROOTS);
}
