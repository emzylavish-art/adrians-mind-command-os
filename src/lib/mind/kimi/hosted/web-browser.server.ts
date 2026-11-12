import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { adrianBuildCommand, adrianBuildEnv, packageLabel } from "./acp-client.ts";

const PORT = 58631;

type BrowserRun = {
  child: ChildProcess;
  port: number;
};

let running: BrowserRun | null = null;

function redact(text: string): string {
  return text
    .replace(/xai-[A-Za-z0-9_-]{8,}/g, "[saved key]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[saved key]")
    .replace(/token[=:\s]+[A-Za-z0-9._~+/-]{8,}/gi, "token=[redacted]")
    .slice(0, 280);
}

function tokenFor(env: NodeJS.ProcessEnv): string {
  const home = env.KIMI_CODE_HOME || "/tmp/adrian-build-home";
  return readFileSync(`${home}/server.token`, "utf8").trim();
}

export function codingBrowserStatus() {
  const command = adrianBuildCommand();
  return {
    package: packageLabel(command),
    localOnly: true,
    running: Boolean(running && running.child.exitCode == null),
    port: running?.port,
  };
}

export async function ensureCodingBrowser(): Promise<{ ok: boolean; port?: number; package: string; error?: string }> {
  const command = adrianBuildCommand();
  const label = packageLabel(command);
  if (process.env.VERCEL) {
    return { ok: false, package: label, error: "The coding browser runs on this computer. The public site cannot keep that process open." };
  }
  if (!command.endsWith(".mjs") && !command.endsWith(".js")) {
    return { ok: false, package: label, error: "The in-repo coding package was not found." };
  }
  if (running && running.child.exitCode == null) return { ok: true, port: running.port, package: label };

  const env = adrianBuildEnv();
  const child = spawn(process.execPath, [command, "web", "--no-open", "--port", String(PORT)], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const onData = (chunk: Buffer) => {
    log = redact(`${log}${chunk.toString("utf8")}`).slice(-280);
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  running = { child, port: PORT };

  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      clearInterval(interval);
      resolve(false);
    }, 15_000);
    const check = () => {
      if (child.exitCode != null) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve(false);
        return;
      }
      fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(800) })
        .then((response) => {
          if (!response.ok) return;
          clearTimeout(timer);
          clearInterval(interval);
          resolve(true);
        })
        .catch(() => undefined);
    };
    const interval = setInterval(check, 400);
    child.once("exit", () => {
      clearInterval(interval);
      clearTimeout(timer);
      resolve(false);
    });
    check();
  });
  if (!ready || child.exitCode != null) {
    running = null;
    return { ok: false, package: label, error: log || "The coding browser did not start. No Kimi login was requested." };
  }
  return { ok: true, port: PORT, package: label };
}

export function codingBrowserFrame(port: number): string {
  const token = encodeURIComponent(tokenFor(adrianBuildEnv()));
  const src = `http://127.0.0.1:${port}/#token=${token}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Coding browser</title><style>html,body,iframe{margin:0;height:100%;width:100%;border:0;background:#111;color:#fff}</style></head><body><iframe title="Coding browser" src="${src}"></iframe></body></html>`;
}
