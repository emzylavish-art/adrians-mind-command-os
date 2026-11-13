import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync } from "node:fs";
import { adrianHostedWorkspace } from "./acp-client.ts";

type Pending = { id: string; token: string; command: string; expires: number };

const pending = new Map<string, Pending>();

export function createHostedTerminalApproval(command: string) {
  const id = randomBytes(8).toString("hex");
  const token = randomBytes(16).toString("hex");
  pending.set(id, { id, token, command, expires: Date.now() + 5 * 60_000 });
  return { id, token, command, hosted: true as const };
}

export function snapshotHostedWorkspace(): string {
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `/tmp/adrian-build-checkpoints/${id}`;
  mkdirSync(dest, { recursive: true });
  cpSync(adrianHostedWorkspace(), dest, { recursive: true });
  return id;
}

export function runHostedTerminal(input: { id: string; token: string; command: string }): Promise<{ ok: boolean; text: string; error?: string }> {
  const item = pending.get(input.id);
  if (!item || item.token !== input.token || item.command !== input.command || item.expires < Date.now()) {
    return Promise.resolve({ ok: false, text: "", error: "That approval does not match the command. Nothing ran." });
  }
  pending.delete(input.id);
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
