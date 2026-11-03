/**
 * BuildSession MCP tools — repo / terminal / git scoped to an allowlisted workspace root.
 * Local-PC shell remains `pc_run_shell` (HP Pairing). These tools run on the app host only.
 * Forbidden: git push, force, reset --hard, and other destructive git.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type { ToolResult } from "./tools.ts";

const DEFAULT_ALLOWED_ROOTS = ["/workspace"];
const MAX_READ_BYTES = 200_000;
const MAX_LIST_ENTRIES = 500;
const MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_TIMEOUT_MS = 15_000;

/** Safe terminal commands for BuildSession plan steps (no shell metacharacters). */
export const BUILD_TERMINAL_ALLOWLIST: RegExp[] = [
  /^pwd$/,
  /^ls(?:\s+(?:-[alAhrt1]+\s+)*)?(?:\.|[\w./@+-]+)?$/,
  /^npm(?:\s+(?:test|run\s+(?:typecheck|build|lint|test)|(?:ci|install|--version|-v)))(?:\s+--[\w.-]+)*$/,
  /^node(?:\s+--experimental-strip-types)?\s+[\w./@+-]+\.(?:mjs|js|ts|cjs)$/,
  /^npx\s+tsc(?:\s+--noEmit)?$/,
  /^rg(?:\s+-n)?(?:\s+--glob\s+'[^']+')?\s+[\w./@"' \\+-]+$/,
];

const TERMINAL_SAFE_CHARS = /^[A-Za-z0-9 _.,:=+\/@'"\\*-]+$/;

const FORBIDDEN_GIT = [
  /\bpush\b/i,
  /\bforce\b/i,
  /--force/i,
  /-f\b/,
  /\breset\s+--hard\b/i,
  /\bclean\b/i,
  /\brebase\b/i,
  /\bfilter-branch\b/i,
  /\bcheckout\s+--orphan\b/i,
];

export function buildWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.MIND_BUILD_WORKSPACE_ROOT?.trim();
  return raw || null;
}

export function allowedBuildRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.MIND_BUILD_ALLOWED_ROOTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_ROOTS, ...extra];
}

export function resolveUnderWorkspace(
  workspaceRoot: string,
  relPath: string,
  allowedRoots: string[],
): { ok: true; abs: string; rel: string } | { ok: false; error: string } {
  let rootReal: string;
  try {
    rootReal = realpathSync(workspaceRoot);
  } catch {
    return { ok: false, error: "Build workspace root does not exist. Nothing was read." };
  }
  const allowed = allowedRoots.some((base) => {
    try {
      const baseReal = realpathSync(base);
      const rel = relative(baseReal, rootReal);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    } catch {
      return rootReal === resolve(base) || rootReal.startsWith(resolve(base) + sep);
    }
  });
  if (!allowed) {
    return { ok: false, error: "Build workspace root is outside the allowlisted roots. Nothing was read." };
  }
  const cleaned = (relPath || ".").replace(/\\/g, "/").trim() || ".";
  if (cleaned.includes("\0") || cleaned.split("/").includes("..")) {
    return { ok: false, error: "Path escapes are not allowed. Nothing was read." };
  }
  const abs = normalize(resolve(rootReal, cleaned));
  const rel = relative(rootReal, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, error: "Path escapes the build workspace root. Nothing was read." };
  }
  return { ok: true, abs, rel: rel || "." };
}

function needsWorkspace(env: NodeJS.ProcessEnv): ToolResult {
  return {
    ok: false,
    status: "needs-config",
    text: "MIND_BUILD_WORKSPACE_ROOT is not set. Point it at an allowlisted checkout under /workspace. Nothing ran.",
  };
}

export function isBuildTerminalAllowlisted(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || trimmed.length > 300) return false;
  if (!TERMINAL_SAFE_CHARS.test(trimmed)) return false;
  if (/[;&|`$<>(){}]|\\n|\\r/.test(trimmed)) return false;
  return BUILD_TERMINAL_ALLOWLIST.some((re) => re.test(trimmed));
}

function runCaptured(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C" }, shell: false });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += String(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        code,
        stdout: stdout.slice(0, MAX_OUTPUT_CHARS),
        stderr: stderr.slice(0, MAX_OUTPUT_CHARS),
        timedOut,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ code: null, stdout: "", stderr: err.message, timedOut });
    });
  });
}

export async function buildRepoList(input: {
  path?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ToolResult> {
  const env = input.env ?? process.env;
  const root = buildWorkspaceRoot(env);
  if (!root) return needsWorkspace(env);
  const resolved = resolveUnderWorkspace(root, input.path ?? ".", allowedBuildRoots(env));
  if (!resolved.ok) return { ok: false, status: "error", text: resolved.error };
  if (!existsSync(resolved.abs) || !statSync(resolved.abs).isDirectory()) {
    return { ok: false, status: "error", text: "That path is not a directory in the build workspace. Nothing was listed." };
  }
  const names = readdirSync(resolved.abs).slice(0, MAX_LIST_ENTRIES);
  const entries = names.map((name) => {
    const abs = join(resolved.abs, name);
    let type: "file" | "dir" | "other" = "other";
    try {
      const st = statSync(abs);
      type = st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
    } catch {
      type = "other";
    }
    return { name, type, path: join(resolved.rel === "." ? "" : resolved.rel, name).replace(/\\/g, "/") || name };
  });
  return {
    ok: true,
    status: "ok",
    text: `${entries.length} entr${entries.length === 1 ? "y" : "ies"} under ${resolved.rel}.`,
    data: { root, path: resolved.rel, entries },
  };
}

export async function buildRepoRead(input: {
  path: string;
  maxBytes?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<ToolResult> {
  const env = input.env ?? process.env;
  const root = buildWorkspaceRoot(env);
  if (!root) return needsWorkspace(env);
  const path = (input.path || "").trim();
  if (!path) return { ok: false, status: "error", text: "path is required. Nothing was read." };
  const resolved = resolveUnderWorkspace(root, path, allowedBuildRoots(env));
  if (!resolved.ok) return { ok: false, status: "error", text: resolved.error };
  if (!existsSync(resolved.abs) || !statSync(resolved.abs).isFile()) {
    return { ok: false, status: "error", text: "That file was not found in the build workspace. Nothing was read." };
  }
  const cap = Math.min(MAX_READ_BYTES, Math.max(1, Math.floor(input.maxBytes ?? MAX_READ_BYTES)));
  const buf = readFileSync(resolved.abs);
  const truncated = buf.byteLength > cap;
  const content = buf.subarray(0, cap).toString("utf8");
  return {
    ok: true,
    status: "ok",
    text: truncated ? `Read ${cap} bytes (truncated) from ${resolved.rel}.` : `Read ${buf.byteLength} bytes from ${resolved.rel}.`,
    data: { path: resolved.rel, bytes: buf.byteLength, truncated, content },
  };
}

export async function buildTerminalRun(input: {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ToolResult> {
  const env = input.env ?? process.env;
  const root = buildWorkspaceRoot(env);
  if (!root) return needsWorkspace(env);
  const command = (input.command || "").trim();
  if (!command) return { ok: false, status: "error", text: "command is required. Nothing ran." };
  if (!isBuildTerminalAllowlisted(command)) {
    return {
      ok: false,
      status: "error",
      text: "That command is not on the BuildSession terminal allowlist. Nothing ran.",
    };
  }
  const resolved = resolveUnderWorkspace(root, input.cwd ?? ".", allowedBuildRoots(env));
  if (!resolved.ok) return { ok: false, status: "error", text: resolved.error };
  const timeoutMs = Math.min(
    60_000,
    Math.max(1_000, Number(env.MIND_BUILD_TERMINAL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
  );
  // Parse without shell: first token is argv0.
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((p) => p.replace(/^['"]|['"]$/g, "")) ?? [];
  if (!parts.length) return { ok: false, status: "error", text: "Empty command. Nothing ran." };
  const [argv0, ...args] = parts;
  const result = await runCaptured(argv0!, args, resolved.abs, timeoutMs);
  if (result.timedOut) {
    return { ok: false, status: "error", text: `Command timed out after ${timeoutMs}ms. Nothing else ran.`, data: result };
  }
  const text = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(0, MAX_OUTPUT_CHARS) || "(empty output)";
  return {
    ok: result.code === 0,
    status: result.code === 0 ? "ok" : "error",
    text,
    data: { code: result.code, cwd: resolved.rel },
  };
}

function assertSafeGitArgs(args: string[]): string | null {
  const joined = args.join(" ");
  for (const re of FORBIDDEN_GIT) {
    if (re.test(joined)) return "That git operation is forbidden (no push/force/reset --hard/clean/rebase). Nothing ran.";
  }
  return null;
}

export async function buildGitStatus(input: { env?: NodeJS.ProcessEnv } = {}): Promise<ToolResult> {
  const env = input.env ?? process.env;
  const root = buildWorkspaceRoot(env);
  if (!root) return needsWorkspace(env);
  const resolved = resolveUnderWorkspace(root, ".", allowedBuildRoots(env));
  if (!resolved.ok) return { ok: false, status: "error", text: resolved.error };
  const result = await runCaptured("git", ["status", "--porcelain=v1", "-b"], resolved.abs, DEFAULT_TIMEOUT_MS);
  if (result.timedOut) return { ok: false, status: "error", text: "git status timed out. Nothing else ran." };
  const text = (result.stdout || result.stderr || "(empty)").slice(0, MAX_OUTPUT_CHARS);
  return { ok: result.code === 0, status: result.code === 0 ? "ok" : "error", text, data: { code: result.code } };
}

export async function buildGitDiff(input: {
  path?: string;
  staged?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<ToolResult> {
  const env = input.env ?? process.env;
  const root = buildWorkspaceRoot(env);
  if (!root) return needsWorkspace(env);
  const resolved = resolveUnderWorkspace(root, ".", allowedBuildRoots(env));
  if (!resolved.ok) return { ok: false, status: "error", text: resolved.error };
  const args = ["diff", "--no-color"];
  if (input.staged) args.push("--cached");
  if (input.path?.trim()) {
    const file = resolveUnderWorkspace(root, input.path.trim(), allowedBuildRoots(env));
    if (!file.ok) return { ok: false, status: "error", text: file.error };
    args.push("--", file.rel);
  }
  const banned = assertSafeGitArgs(args);
  if (banned) return { ok: false, status: "error", text: banned };
  const result = await runCaptured("git", args, resolved.abs, DEFAULT_TIMEOUT_MS);
  if (result.timedOut) return { ok: false, status: "error", text: "git diff timed out. Nothing else ran." };
  const text = (result.stdout || result.stderr || "(empty diff)").slice(0, MAX_OUTPUT_CHARS);
  return { ok: result.code === 0, status: result.code === 0 ? "ok" : "error", text, data: { code: result.code } };
}

export async function buildGitCommit(input: {
  message: string;
  paths?: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<ToolResult> {
  const env = input.env ?? process.env;
  const root = buildWorkspaceRoot(env);
  if (!root) return needsWorkspace(env);
  const message = (input.message || "").trim().slice(0, 2000);
  if (!message) return { ok: false, status: "error", text: "Commit message is required. Nothing ran." };
  if (/^-/.test(message)) return { ok: false, status: "error", text: "Commit message must not look like a flag. Nothing ran." };
  const resolved = resolveUnderWorkspace(root, ".", allowedBuildRoots(env));
  if (!resolved.ok) return { ok: false, status: "error", text: resolved.error };

  const paths = Array.isArray(input.paths) ? input.paths.map((p) => String(p).trim()).filter(Boolean).slice(0, 50) : [];
  if (paths.length) {
    const rels: string[] = [];
    for (const p of paths) {
      const file = resolveUnderWorkspace(root, p, allowedBuildRoots(env));
      if (!file.ok) return { ok: false, status: "error", text: file.error };
      rels.push(file.rel);
    }
    const addArgs = ["add", "--", ...rels];
    const bannedAdd = assertSafeGitArgs(addArgs);
    if (bannedAdd) return { ok: false, status: "error", text: bannedAdd };
    const added = await runCaptured("git", addArgs, resolved.abs, DEFAULT_TIMEOUT_MS);
    if (added.timedOut || added.code !== 0) {
      return {
        ok: false,
        status: "error",
        text: added.timedOut ? "git add timed out. Nothing committed." : `git add failed. ${added.stderr || added.stdout}`.slice(0, 500),
      };
    }
  }

  const commitArgs = ["commit", "-m", message];
  const banned = assertSafeGitArgs(commitArgs);
  if (banned) return { ok: false, status: "error", text: banned };
  // Defense in depth: never accept --amend/--no-verify from callers (not in argv).
  const result = await runCaptured("git", commitArgs, resolved.abs, DEFAULT_TIMEOUT_MS);
  if (result.timedOut) return { ok: false, status: "error", text: "git commit timed out. Nothing else ran." };
  const text = (result.stdout || result.stderr || "").slice(0, MAX_OUTPUT_CHARS) || "Commit finished.";
  return {
    ok: result.code === 0,
    status: result.code === 0 ? "ok" : "error",
    text,
    data: { code: result.code },
  };
}
