/**
 * Stdio (kind=command) MCP execution for the registry.
 *
 * Server-side only. A child process is spawned ONLY when the caller asks to
 * list or call tools on an enabled server; every session closes and kills its
 * child before returning (spawn-per-request, no long-lived cache).
 *
 * - initialize + tools/list / tools/call via the official SDK Client + StdioClientTransport
 * - connect timeout and per-call timeout (defaults 10s / 30s, configurable)
 * - child env is NOT the app env: only the SDK's safe base (PATH, HOME, plus the
 *   sudo-style LOGNAME/SHELL/TERM/USER the SDK always adds) and the server's own env
 * - stdout protocol buffer and stderr capture are capped
 * - SECURITY: any signed-in user (or anyone, in auth-disabled dev mode) can
 *   register a command server, so registration alone must never be enough to
 *   run a binary on this host. A child is spawned ONLY when the exact command
 *   is on the operator allowlist MIND_MCP_STDIO_ALLOW (server env, never user
 *   input). Default: empty -> stdio execution is refused. Loader-injection env
 *   keys (LD_PRELOAD, NODE_OPTIONS, ...) from the server config are dropped.
 *   Allowlisting an interpreter (node, python, npx, sh) with user-chosen args
 *   is equivalent to giving every signed-in user shell on this host.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type StdioServerConfig = {
  id: string;
  label: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
};

export type StdioOptions = {
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  /** Max bytes of stderr kept for diagnostics. */
  stderrCapBytes?: number;
  /** Max bytes buffered from stdout before the session is aborted. */
  stdoutCapBytes?: number;
  /** Env used to read the operator allowlist (tests). Defaults to process.env. */
  allowEnv?: NodeJS.ProcessEnv;
};

export type StdioStatus = "ok" | "error" | "timeout";

export type StdioListedTool = { name: string; description: string };

export type StdioListResult =
  | { status: "ok"; tools: StdioListedTool[]; stderr: string }
  | { status: "error" | "timeout"; error: string; stderr: string };

export type StdioCallResult = {
  status: StdioStatus;
  ok: boolean;
  text: string;
  stderr: string;
  data?: Record<string, unknown> | null;
};

export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_CALL_TIMEOUT_MS = 30_000;
export const DEFAULT_STDERR_CAP_BYTES = 4_096;
export const DEFAULT_STDOUT_CAP_BYTES = 1_000_000;
const MAX_TEXT_CHARS = 8_000;
const CLOSE_GRACE_MS = 5_000;

const ALLOWED_PARENT_ENV = ["PATH", "HOME"] as const;

/** Operator allowlist env var: exact command strings separated by newline, ";" or ",". */
export const STDIO_ALLOW_ENV = "MIND_MCP_STDIO_ALLOW";

/** Parse the operator allowlist. Empty/unset -> no command may run. */
export function stdioAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[STDIO_ALLOW_ENV];
  if (typeof raw !== "string") return [];
  return raw
    .split(/[\n;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);
}

/** True only when the exact (trimmed) command string is on the operator allowlist. */
export function stdioCommandAllowed(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const wanted = command.trim();
  if (!wanted) return false;
  return stdioAllowlist(env).includes(wanted);
}

import { isBlockedChildEnvKey } from "./stdio-policy.ts";

export { isBlockedChildEnvKey };

function clampMs(value: unknown, fallback: number, min = 100, max = 300_000): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Resolve effective timeouts: explicit option > per-server config > env > default. */
export function resolveStdioTimeouts(
  server: Pick<StdioServerConfig, "connectTimeoutMs" | "callTimeoutMs">,
  options: StdioOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): { connectTimeoutMs: number; callTimeoutMs: number } {
  const connectBase = clampMs(env.MIND_MCP_STDIO_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS);
  const callBase = clampMs(env.MIND_MCP_STDIO_CALL_TIMEOUT_MS, DEFAULT_CALL_TIMEOUT_MS);
  return {
    connectTimeoutMs: clampMs(options.connectTimeoutMs ?? server.connectTimeoutMs, connectBase),
    callTimeoutMs: clampMs(options.callTimeoutMs ?? server.callTimeoutMs, callBase),
  };
}

/**
 * Environment handed to the child. Only PATH/HOME are copied from the app
 * process; everything else must come from the server's own configured env.
 */
export function buildStdioChildEnv(
  serverEnv: Record<string, string> | undefined,
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ALLOWED_PARENT_ENV) {
    const value = parent[key];
    if (typeof value === "string" && !value.startsWith("()")) env[key] = value;
  }
  for (const [key, value] of Object.entries(serverEnv ?? {})) {
    if (isBlockedChildEnvKey(key)) continue;
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

class StdioTimeoutError extends Error {
  constructor(phase: string, ms: number) {
    super(`${phase} timed out after ${ms} ms`);
    this.name = "StdioTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, phase: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StdioTimeoutError(phase, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isTimeout(error: unknown): boolean {
  if (error instanceof StdioTimeoutError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  // SDK ErrorCode.RequestTimeout
  return code === -32001;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

function cap(text: string, bytes: number): string {
  if (Buffer.byteLength(text) <= bytes) return text;
  return `${Buffer.from(text).subarray(0, bytes).toString()}…[truncated]`;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/* Track live children so a crashing/exiting app never leaves orphans behind. */
const liveChildren = new Set<number>();
let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const pid of liveChildren) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  });
}

/** Number of stdio MCP children currently alive (for tests and diagnostics). */
export function activeStdioChildren(): number {
  for (const pid of liveChildren) if (!pidAlive(pid)) liveChildren.delete(pid);
  return liveChildren.size;
}

let spawnCount = 0;
/** Total stdio children this process has spawned (for tests). */
export function stdioSpawnCount(): number {
  return spawnCount;
}

type SessionOutcome<T> =
  | { ok: true; value: T; stderr: string }
  | { ok: false; status: "error" | "timeout"; error: string; stderr: string };

async function withStdioSession<T>(
  server: StdioServerConfig,
  options: StdioOptions,
  run: (client: Client, callTimeoutMs: number) => Promise<T>,
): Promise<SessionOutcome<T>> {
  const command = server.command?.trim();
  if (!command) return { ok: false, status: "error", error: "No command is configured. Nothing was started.", stderr: "" };
  if (!stdioCommandAllowed(command, options.allowEnv ?? process.env)) {
    return {
      ok: false,
      status: "error",
      error: `Command “${command.slice(0, 120)}” is not on the server operator allowlist (${STDIO_ALLOW_ENV}). Nothing was started.`,
      stderr: "",
    };
  }
  const { connectTimeoutMs, callTimeoutMs } = resolveStdioTimeouts(server, options);
  const stderrCap = options.stderrCapBytes ?? DEFAULT_STDERR_CAP_BYTES;
  let stderr = "";

  installExitHook();
  const transport = new StdioClientTransport({
    command,
    args: server.args ?? [],
    env: buildStdioChildEnv(server.env),
    cwd: server.cwd,
    stderr: "pipe",
    maxBufferSize: options.stdoutCapBytes ?? DEFAULT_STDOUT_CAP_BYTES,
  });
  transport.stderr?.on("data", (chunk: Buffer | string) => {
    if (Buffer.byteLength(stderr) >= stderrCap) return;
    stderr = cap(stderr + chunk.toString(), stderrCap);
  });
  const client = new Client({ name: "adrians-mind", version: "1" }, { capabilities: {} });
  let pid: number | null = null;
  spawnCount += 1;
  try {
    await withTimeout(client.connect(transport, { timeout: connectTimeoutMs }), connectTimeoutMs, "connect (initialize)");
    pid = transport.pid ?? pid;
    if (pid) liveChildren.add(pid);
    const value = await run(client, callTimeoutMs);
    return { ok: true, value, stderr };
  } catch (error) {
    pid = transport.pid ?? pid;
    const timedOut = isTimeout(error);
    if (timedOut && pid) {
      // A hung child gets no grace period: stop it now, close() below reaps it.
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* gone */
      }
    }
    return {
      ok: false,
      status: timedOut ? "timeout" : "error",
      error: timedOut
        ? error instanceof StdioTimeoutError
          ? error.message
          : `request timed out after ${callTimeoutMs} ms`
        : `Stdio MCP failed: ${errorText(error)}`,
      stderr,
    };
  } finally {
    pid = pid ?? transport.pid;
    await withTimeout(client.close(), CLOSE_GRACE_MS, "close").catch(() => undefined);
    if (pid && pidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* gone */
      }
    }
    if (pid) liveChildren.delete(pid);
  }
}

export async function listStdioTools(server: StdioServerConfig, options: StdioOptions = {}): Promise<StdioListResult> {
  const outcome = await withStdioSession(server, options, async (client, callTimeoutMs) => {
    const listed = await withTimeout(client.listTools(undefined, { timeout: callTimeoutMs }), callTimeoutMs, "tools/list");
    return (listed.tools ?? [])
      .filter((tool) => typeof tool?.name === "string" && tool.name)
      .slice(0, 200)
      .map((tool) => ({ name: tool.name.slice(0, 80), description: (tool.description ?? "").slice(0, 200) }));
  });
  if (!outcome.ok) return { status: outcome.status, error: outcome.error, stderr: outcome.stderr };
  return { status: "ok", tools: outcome.value, stderr: outcome.stderr };
}

export async function callStdioTool(
  server: StdioServerConfig,
  tool: string,
  args: Record<string, unknown>,
  options: StdioOptions = {},
): Promise<StdioCallResult> {
  const outcome = await withStdioSession(server, options, async (client, callTimeoutMs) =>
    withTimeout(
      client.callTool({ name: tool, arguments: args }, undefined, { timeout: callTimeoutMs }),
      callTimeoutMs,
      `tools/call ${tool}`,
    ),
  );
  if (!outcome.ok) {
    const text =
      outcome.status === "timeout"
        ? `Stdio MCP “${server.label}” ${outcome.error}. The process was stopped; no result is claimed.`
        : `${outcome.error} Nothing was claimed.`;
    const withStderr = outcome.stderr ? `${text}\nstderr: ${outcome.stderr.slice(0, 300)}` : text;
    return { status: outcome.status, ok: false, text: withStderr, stderr: outcome.stderr };
  }
  const result = outcome.value as { content?: unknown; isError?: boolean; structuredContent?: unknown };
  const parts = Array.isArray(result.content) ? (result.content as { type?: string; text?: string }[]) : [];
  const content = parts
    .map((part) => (part?.type === "text" || typeof part?.text === "string" ? part.text ?? "" : `[${part?.type ?? "content"}]`))
    .join("\n")
    .slice(0, MAX_TEXT_CHARS);
  const isError = result.isError === true;
  const structured =
    result.structuredContent && typeof result.structuredContent === "object"
      ? (result.structuredContent as Record<string, unknown>)
      : null;
  return {
    status: isError || !content ? "error" : "ok",
    ok: !isError && Boolean(content),
    text: content || "The MCP server returned no text. Nothing was invented.",
    stderr: outcome.stderr,
    data: structured,
  };
}
