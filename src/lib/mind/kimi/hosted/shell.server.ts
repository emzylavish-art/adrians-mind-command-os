import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { adrianHostedWorkspace } from "./acp-client.ts";

type Pending = { id: string; token: string; command: string; expires: number };

const pending = new Map<string, Pending>();

export function createHostedTerminalApproval(command: string) {
  const id = randomBytes(8).toString("hex");
  const token = randomBytes(16).toString("hex");
  const expires = Date.now() + 5 * 60_000;
  pending.set(id, { id, token, command, expires });
  return { id, token, command, hosted: true as const, expiresAt: new Date(expires).toISOString() };
}

const BLOCKED_HOSTED_COMMAND = /(?:\bsudo\b|\brm\s+-[^\n]*r|\bgit\s+push\b[^\n]*(?:--force|\s-f\b)|\b(?:curl|wget)\b[^\n]*\|\s*(?:sh|bash)\b|\bmkfs\b|\bdd\s+if=|\b(?:shutdown|reboot|poweroff)\b|\bchmod\s+-R\s+777\s+\/)/i;

export function hostedCommandRefusal(command: string): string | null {
  if (BLOCKED_HOSTED_COMMAND.test(command)) return "That command is blocked on the server. Nothing ran.";
  return null;
}

function runGit(args: string[], workspace = adrianHostedWorkspace()): Promise<{ code: number; text: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd: workspace,
      env: { PATH: process.env.PATH || "/usr/bin:/bin", HOME: workspace, GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" },
      timeout: 8_000,
    });
    let text = "";
    const take = (chunk: Buffer) => {
      text = `${text}${chunk.toString("utf8")}`.slice(0, 12_000);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => resolve({ code: 1, text: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, text }));
  });
}

export async function readHostedGitBranch(workspace: string): Promise<string | null> {
  const branch = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], workspace);
  return branch.code === 0 ? branch.text.trim() || null : null;
}

export async function inspectHostedGit() {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0) {
    return {
      ok: true,
      repo: false,
      branch: "",
      status: "",
      diff: "",
      log: "",
      notice: "This workspace is not a Git repository. Nothing was initialized, committed, or pushed.",
    };
  }
  const [branch, status, diff, untracked, log] = await Promise.all([
    runGit(["branch", "--show-current"]),
    runGit(["status", "--short", "--branch"]),
    runGit(["diff", "--", "."]),
    runGit(["ls-files", "--others", "--exclude-standard"]),
    runGit(["log", "-5", "--oneline"]),
  ]);
  return {
    ok: true,
    repo: true,
    branch: branch.text.trim() || "HEAD",
    status: status.text,
    diff: diff.text,
    untracked: untracked.text,
    log: log.text,
    notice: "Local Git read only. This is not a commit, push, or deployment.",
  };
}

export async function initHostedGit() {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0) {
    const made = await runGit(["init"]);
    if (made.code !== 0) return { ok: false, error: made.text || "Local Git could not be started. Nothing was pushed." };
  }
  return inspectHostedGit();
}

export async function commitHostedGit(message: string) {
  const trimmed = message.trim().slice(0, 200);
  if (!trimmed) return { ok: false, error: "A commit message is required. Nothing was committed or pushed." };
  const started = await initHostedGit();
  if (!started.ok) return started;
  const added = await runGit(["add", "-A"]);
  if (added.code !== 0) return { ok: false, error: added.text || "The local files could not be staged. Nothing was committed or pushed." };
  const committed = await runGit(["-c", "user.email=adrian-build@local", "-c", "user.name=Adrian Build", "commit", "-m", trimmed]);
  if (committed.code !== 0) return { ok: false, error: committed.text || "Nothing was committed. Nothing was pushed." };
  const report = await inspectHostedGit();
  return { ...report, ok: true, committed: true, notice: `Local commit created. Nothing was pushed or deployed. ${committed.text.trim()}` };
}

export async function branchHostedGit(name: string) {
  const branch = name.trim();
  if (!/^[\w.-]{1,60}$/.test(branch) || branch.includes("..")) return { ok: false, error: "Use a short branch name with letters, numbers, dots, or dashes. Nothing was created or pushed." };
  const started = await initHostedGit();
  if (!("repo" in started) || !started.ok) return { ok: false, error: "error" in started ? started.error : "Local Git is not ready. Nothing was pushed." };
  const made = await runGit(["checkout", "-b", branch]);
  if (made.code !== 0) return { ok: false, error: made.text || "The branch was not created. Nothing was pushed." };
  const report = await inspectHostedGit();
  return { ...report, ok: true, notice: `Local branch ${branch} is checked out. Nothing was pushed or deployed.` };
}

export function snapshotHostedWorkspace(): string {
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `/tmp/adrian-build-checkpoints/${id}`;
  mkdirSync(dest, { recursive: true });
  cpSync(adrianHostedWorkspace(), dest, { recursive: true });
  return id;
}

export function listHostedCheckpoints(): string[] {
  const root = "/tmp/adrian-build-checkpoints";
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((id) => existsSync(`${root}/${id}`)).sort().reverse().slice(0, 8);
}

export function restoreHostedCheckpoint(id: string): boolean {
  if (!/^[\dTZ-]+$/.test(id)) return false;
  const source = `/tmp/adrian-build-checkpoints/${id}`;
  if (!existsSync(source)) return false;
  const workspace = adrianHostedWorkspace();
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  cpSync(source, workspace, { recursive: true });
  return true;
}

export function runHostedTerminal(input: { id: string; token: string; command: string }): Promise<{ ok: boolean; text: string; error?: string }> {
  const item = pending.get(input.id);
  if (!item || item.token !== input.token || item.command !== input.command || item.expires < Date.now()) {
    return Promise.resolve({ ok: false, text: "", error: "That approval does not match the command. Nothing ran." });
  }
  pending.delete(input.id);
  const refused = hostedCommandRefusal(item.command);
  if (refused) return Promise.resolve({ ok: false, text: "", error: refused });
  if (item.command.length > 500) return Promise.resolve({ ok: false, text: "", error: "Command is too long. Nothing ran." });
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", item.command], {
      cwd: adrianHostedWorkspace(),
      env: {
        PATH: process.env.PATH || "/usr/bin:/bin",
        HOME: adrianHostedWorkspace(),
        LANG: "C.UTF-8",
      },
      timeout: 20_000,
    });
    let text = "";
    const take = (chunk: Buffer) => {
      text = `${text}${chunk.toString("utf8")}`.slice(0, 16_000);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => resolve({ ok: false, text, error: error.message }));
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        text: text || (code === 0 ? "Command finished with no output." : ""),
        error: code === 0 ? undefined : `Command exited ${code ?? "unknown"}.`,
      });
    });
  });
}
