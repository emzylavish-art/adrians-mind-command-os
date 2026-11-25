import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { adrianBuildCommand, adrianBuildEnv, packageLabel } from "./acp-client.ts";
import { ensureCodingSearchBridge } from "./coding-search-bridge.server.ts";
import { localDataPath } from "../../../local-data.ts";

type BrowserRun = { child: ChildProcess; port: number; home: string; owner: string };
type StartResult = { ok: boolean; package: string; error?: string };
let running: BrowserRun | null = null;
let starting: { owner: string; promise: Promise<StartResult> } | null = null;

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error || !address || typeof address === "string") reject(error ?? new Error("No local port available."));
        else resolve(address.port);
      });
    });
  });
}

function activeRun(owner: string): BrowserRun | null {
  return running?.owner === owner && running.child.exitCode === null && running.child.signalCode === null && !running.child.killed ? running : null;
}

export function codingBrowserStatus(owner: string) {
  return { package: packageLabel(adrianBuildCommand()), localOnly: true, running: Boolean(activeRun(owner)) };
}

async function start(owner: string): Promise<StartResult> {
  const command = adrianBuildCommand();
  const label = packageLabel(command);
  if (process.env.VERCEL || (!command.endsWith(".mjs") && !command.endsWith(".js"))) {
    return { ok: false, package: label, error: "Start the installed coding package on this computer." };
  }
  const bridge = await ensureCodingSearchBridge();
  if (!bridge.ok) return { ok: false, package: label, error: "The coding search bridge did not start." };
  const port = await availablePort();
  const home = join(localDataPath("coding-browser"), createHash("sha256").update(owner).digest("hex"));
  const child = spawn(process.execPath, [command, "web", "--no-open", "--port", String(port)], {
    cwd: process.cwd(), env: adrianBuildEnv(home), stdio: "ignore",
  });
  let failed = false;
  child.once("error", () => { failed = true; });
  child.once("exit", () => { if (running?.child === child) running = null; });
  const deadline = Date.now() + 15_000;
  while (!failed && child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500), redirect: "error" });
      await response.body?.cancel();
      if (response.ok && (await readFile(join(home, "server.token"), "utf8")).trim()) {
        running = { child, port, home, owner };
        return { ok: true, package: label };
      }
    } catch { /* The process may still be starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (child.exitCode === null && child.signalCode === null) child.kill();
  return { ok: false, package: label, error: "The local coding browser did not start." };
}

export async function ensureCodingBrowser(owner: string): Promise<StartResult> {
  const status = codingBrowserStatus(owner);
  if (status.running) return { ok: true, package: status.package };
  if (starting?.owner === owner) return starting.promise;
  if (starting || running) return { ok: false, package: status.package, error: "The coding browser is in use on this computer." };
  const promise = start(owner).catch(() => ({ ok: false, package: status.package, error: "The local coding browser is unavailable." }));
  starting = { owner, promise };
  try { return await promise; } finally { starting = null; }
}

export async function closeCodingBrowser(owner: string): Promise<boolean> {
  if (starting?.owner === owner) await starting.promise;
  const run = activeRun(owner);
  if (!run) return false;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      run.child.removeListener("exit", closed);
      resolve(false);
    }, 4000);
    function closed() { clearTimeout(timer); resolve(true); }
    run.child.once("exit", closed);
    if (!run.child.kill()) { clearTimeout(timer); run.child.removeListener("exit", closed); resolve(false); }
  });
}

export async function codingBrowserFrame(owner: string): Promise<string | null> {
  const run = activeRun(owner);
  if (!run) return null;
  let token: string;
  try { token = (await readFile(join(run.home, "server.token"), "utf8")).trim(); } catch { return null; }
  if (!token || activeRun(owner) !== run) return null;
  const src = `http://127.0.0.1:${run.port}/#token=${encodeURIComponent(token)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Coding browser</title><style>html,body,iframe{margin:0;height:100%;width:100%;border:0;background:#111;color:#fff}</style></head><body><iframe title="Coding browser" src="${src}"></iframe></body></html>`;
}
