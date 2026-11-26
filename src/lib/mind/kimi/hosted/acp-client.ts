import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { codingFileRequest, type CodingToolReceipt, type CodingFileChange } from "./file-receipts.ts";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { resolveXaiInferenceApiKey } from "../../media/xai-key.ts";
import { installCodingExtensions } from "./coding-extensions.server.ts";
import { codingSearchUrl } from "./coding-search-bridge.server.ts";
import { ADRIAN_OS_BUILDER_ORDER } from "../../adrian-os-skill.ts";
import { localDataPath } from "../../../local-data.ts";

export type KimiProbe = {
  status: "session_created" | "authentication_required" | "failed" | "not_configured";
  command: string;
  version?: string;
  agentName?: string;
  protocolVersion?: number;
  loadSession?: boolean;
  forkAdvertised?: boolean;
  error?: string;
  runtimeVerified: false;
  requestDispatched?: boolean;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function publicError(text: string): string {
  return text.replace(/xai-[A-Za-z0-9_-]{8,}/g, "[saved key]").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[saved key]").slice(0, 400);
}

function textFrom(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => textFrom(item, depth + 1)).filter(Boolean).join("");
  if (!isObject(value)) return "";
  const direct = typeof value.text === "string" ? value.text : "";
  return [direct, textFrom(value.content, depth + 1), textFrom(value.update, depth + 1)].filter(Boolean).join("");
}

export function packageLabel(command: string): string {
  const marker = "node_modules/@moonshot-ai/kimi-code/dist/main.mjs";
  return command.includes(marker) ? marker : "in-repo coding package";
}

export const HOSTED_BUILD_MODEL = "grok-4.20-0309-non-reasoning";

export function adrianBuildEnv(home = process.env.KIMI_CODE_HOME || localDataPath("adrian-build-home")): NodeJS.ProcessEnv {
  const key = resolveXaiInferenceApiKey();
  mkdirSync(home, { recursive: true });
  mkdirSync(adrianHostedWorkspace(), { recursive: true });
  installCodingExtensions(home, codingSearchUrl());
  return {
    ...process.env,
    KIMI_CODE_HOME: home,
    KIMI_DISABLE_TELEMETRY: "1",
    KIMI_CODE_NO_AUTO_UPDATE: "1",
    KIMI_CODE_TRUST_WORKSPACE: "1",
    KIMI_CODE_IDENTITY_NAME: "Adrian",
    KIMI_CODE_IDENTITY_SLUG: "adrian",
    KIMI_MODEL_NAME: HOSTED_BUILD_MODEL,
    KIMI_MODEL_PROVIDER_TYPE: "openai",
    KIMI_MODEL_BASE_URL: "https://api.x.ai/v1",
    KIMI_MODEL_API_KEY: key || "",
    KIMI_MODEL_DISPLAY_NAME: "Adrian Grok",
    KIMI_MODEL_CAPABILITIES: "tool_use",
    KIMI_MODEL_MAX_CONTEXT_SIZE: "131072",
    KIMI_WEB_SEARCH_BASE_URL: codingSearchUrl(),
    KIMI_WEB_SEARCH_API_KEY: "adrian-local",
  };
}

export function adrianBuildCommand(env: NodeJS.ProcessEnv = process.env): string {
  const packaged = fileURLToPath(new URL("../../../../../node_modules/@moonshot-ai/kimi-code/dist/main.mjs", import.meta.url));
  const candidates = [
    env.KIMI_BIN,
    packaged,
    fileURLToPath(new URL("../../../../../node_modules/@moonshot-ai/kimi-code/dist/main.mjs", import.meta.url)),
    "/home/ubuntu/.nvm/versions/node/v22.13.0/lib/node_modules/@moonshot-ai/kimi-code/dist/main.mjs",
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return env.KIMI_BIN || "kimi";
}

export function adrianHostedWorkspace(): string {
  const dir = resolve(process.env.ADRIAN_BUILD_WORKSPACE || localDataPath("adrian-build-workspace"));
  mkdirSync(dir, { recursive: true });
  const legacy = "/tmp/adrian-build-workspace";
  if (dir !== legacy && existsSync(legacy) && readdirSync(dir).length === 0) {
    cpSync(legacy, dir, { recursive: true, filter: (source) => !source.includes(".env") && !source.split("/").includes(".git") });
  }
  return dir;
}

export function resolveBuildWorkspace(input: string | undefined): string {
  const requested = input?.trim();
  if (!requested) return adrianHostedWorkspace();
  const root = adrianHostedWorkspace();
  const candidate = resolve(requested);
  if (candidate === root || candidate.startsWith(`${root}/`)) return candidate;
  return requested;
}

export async function probeKimiAcp(command = adrianBuildCommand(), cwd = process.cwd()): Promise<KimiProbe> {
  return await exchange(command, cwd, []);
}

export async function runHostedPrompt(prompt: string, command = adrianBuildCommand(), cwd = process.cwd()): Promise<KimiProbe & { output?: string }> {
  return await exchange(command, cwd, [prompt]);
}

async function exchange(command: string, cwd: string, prompts: string[]): Promise<KimiProbe & { output?: string }> {
  if (!command.trim()) return { status: "not_configured", command, error: "Kimi command is not configured.", runtimeVerified: false };
  return await new Promise((resolve) => {
    const script = command.endsWith(".mjs") || command.endsWith(".js");
    const child = spawn(script ? process.execPath : command, script ? [command, "acp"] : ["acp"], {
      cwd,
      env: adrianBuildEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    let settled = false;
    const seen: KimiProbe & { output?: string } = { status: "failed", command, runtimeVerified: false, requestDispatched: false };
    const finish = (probe: KimiProbe & { output?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(probe);
    };
    const timer = setTimeout(() => {
      const accepted = prompts.length ? Boolean(seen.output) : Boolean(seen.agentName);
      finish({
        ...seen,
        status: accepted ? "session_created" : "failed",
        error: accepted ? undefined : publicError(seen.error || (prompts.length ? "The coding package did not finish the task within 60 seconds." : "The coding package did not finish the handshake within 12 seconds.")),
      });
    }, prompts.length ? 60_000 : 12_000);
    child.on("error", (error) => finish({ status: "not_configured", command, error: error.message, runtimeVerified: false }));
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false }, clientInfo: { name: "adrian-os", version: "0.1" } } })}\n`);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: JsonObject;
        try { message = JSON.parse(line) as JsonObject; } catch { continue; }
        if (message.id === 1 && isObject(message.result)) {
          const info = isObject(message.result.agentInfo) ? message.result.agentInfo : {};
          const caps = isObject(message.result.agentCapabilities) ? message.result.agentCapabilities : {};
          const sessions = isObject(caps.sessionCapabilities) ? caps.sessionCapabilities : {};
          seen.version = typeof info.version === "string" ? info.version : undefined;
          seen.agentName = typeof info.name === "string" ? info.name : undefined;
          seen.protocolVersion = typeof message.result.protocolVersion === "number" ? message.result.protocolVersion : undefined;
          seen.loadSession = caps.loadSession === true;
          seen.forkAdvertised = Object.prototype.hasOwnProperty.call(sessions, "fork");
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd, mcpServers: [] } })}\n`);
        }
        if (message.id === 2) {
          if (isObject(message.error)) {
            const text = typeof message.error.message === "string" ? message.error.message : "Kimi rejected the session.";
            finish({ ...seen, status: /auth/i.test(text) ? "authentication_required" : "failed", error: publicError(text) });
          } else if (prompts.length && isObject(message.result)) {
            const sessionId = typeof message.result.sessionId === "string" ? message.result.sessionId : "";
            if (!sessionId) finish({ ...seen, status: "failed", error: "Kimi created a session without an id." });
            else { seen.requestDispatched = true; child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId, prompt: [{ type: "text", text: `${ADRIAN_OS_BUILDER_ORDER}\n\n${prompts[0]}` }] } })}\n`); }
          } else {
            finish({ ...seen, status: "session_created", error: undefined });
          }
        }
        if (message.method === "session/update") {
          const text = textFrom(message.params).trim();
          if (text) seen.output = `${seen.output || ""}${text}`.slice(0, 1_000_000);
        }
        if (message.id === 3) {
          if (isObject(message.error)) {
            const text = typeof message.error.message === "string" ? message.error.message : "Kimi rejected the task.";
            finish({ ...seen, status: "failed", error: publicError(text) });
          } else {
            const text = textFrom(message.result).trim();
            finish({ ...seen, status: "session_created", error: undefined, output: text || seen.output || "The in-repo coding package accepted the task. No login was requested." });
          }
        }
      }
    });
  });
}

export type CodingMode = "default" | "plan" | "auto" | "yolo";

export type CodingTurn = {
  ok: boolean;
  command: string;
  sessionId?: string;
  mode?: CodingMode;
  resumed?: boolean;
  reused?: boolean;
  processAlive?: boolean;
  pid?: number;
  forkedSessionId?: string;
  output?: string;
  error?: string;
  mcpServers: number;
  clientCalls?: string[];
  processNote?: string;
  operationId?: string;
  requestDispatched?: boolean;
  outputComplete?: boolean;
  outputCharacters?: number;
  toolReceipts?: CodingToolReceipt[];
  filesChanged?: CodingFileChange[];
  verification?: { implementation: "unverified"; builderInstructionDigest: string; checks: { id: string; status: "not_run" }[] };
};

type LiveHandle = {
  child: ReturnType<typeof spawn>;
  cwd: string;
  pid: number;
  nextId: number;
  buffer: string;
  output: string;
  outputCharacters: number;
  outputComplete: boolean;
  receipts: CodingToolReceipt[];
  changes: Map<string, CodingFileChange>;
  clientPending: Set<Promise<void>>;
  ownerId: string;
  persistFile?: (ownerId: string, path: string, content: string) => Promise<boolean>;
  pending: Map<number, (message: JsonObject) => void>;
  mode?: CodingMode;
  closed: boolean;
  idle?: ReturnType<typeof setTimeout>;
  queue: Promise<void>;
  calls: string[];
  stderr: string;
};

const liveSessions = new Map<string, LiveHandle>();
const SESSION_IDLE_MS = 30 * 60_000;
const MAX_CODING_OUTPUT = 1_000_000;
function appendCodingOutput(handle: LiveHandle, text: string) {
  handle.outputCharacters += text.length;
  const remaining = Math.max(0, MAX_CODING_OUTPUT - handle.output.length);
  handle.output += text.slice(0, remaining);
  if (text.length > remaining) handle.outputComplete = false;
}


function closeLive(handle: LiveHandle) {
  if (handle.closed) return;
  handle.closed = true;
  if (handle.idle) clearTimeout(handle.idle);
  for (const [id, current] of liveSessions) {
    if (current === handle) liveSessions.delete(id);
  }
  for (const resolve of handle.pending.values()) resolve({ error: { message: "The coding session was closed." } });
  handle.pending.clear();
  handle.child.kill();
}

export function closeHostedCodingSession(sessionId: string): boolean {
  const handle = liveSessions.get(sessionId);
  if (!handle) return false;
  closeLive(handle);
  return true;
}

function touchLive(handle: LiveHandle) {
  if (handle.idle) clearTimeout(handle.idle);
  handle.idle = setTimeout(() => closeLive(handle), SESSION_IDLE_MS);
  handle.idle.unref?.();
}

function sendLive(handle: LiveHandle, method: string, params: JsonObject): Promise<JsonObject> {
  const id = handle.nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      handle.pending.delete(id);
      resolve({ error: { message: "The coding package did not answer within 120 seconds. The process was left running." } });
    }, 120_000);
    handle.pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    const stdin = handle.child.stdin;
    if (!stdin || stdin.destroyed) {
      clearTimeout(timer);
      handle.pending.delete(id);
      resolve({ error: { message: "The coding process is not accepting requests." } });
      return;
    }
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function attachLive(handle: LiveHandle) {
  const reply = (id: unknown, result: unknown) => {
    handle.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  };
  const fail = (id: unknown, message: string) => {
    handle.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message } })}\n`);
  };
  handle.child.on("exit", () => closeLive(handle));
  handle.child.on("error", () => closeLive(handle));
  handle.child.stdout?.on("data", (chunk: Buffer) => {
    handle.buffer += chunk.toString("utf8");
    const lines = handle.buffer.split("\n");
    handle.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: JsonObject;
      try { message = JSON.parse(line) as JsonObject; } catch { continue; }
      if (typeof message.method === "string" && message.id != null) {
        const allow = handle.mode === "auto" || handle.mode === "yolo";
        const params = isObject(message.params) ? message.params : {};
        handle.calls.push(message.method);
        if (message.method === "session/request_permission") {
          const options = Array.isArray(params.options) ? params.options.filter(isObject) : [];
          const kind = allow ? "allow_once" : "reject_once";
          const match = options.find((option) => option.kind === kind && typeof option.optionId === "string");
          handle.receipts.push({ method: message.method, status: allow && match ? "succeeded" : "denied", detail: allow && match ? "One operation was approved by the acknowledged mode." : "Permission was not granted." });
          reply(message.id, match && typeof match.optionId === "string" ? { outcome: { outcome: "selected", optionId: match.optionId } } : { outcome: { outcome: "cancelled" } });
        } else if (message.method === "fs/read_text_file" || message.method === "fs/write_text_file") {
          const request = codingFileRequest({
            method: message.method, cwd: handle.cwd, ownerId: handle.ownerId, allowWrite: allow, params,
            persist: handle.persistFile || (async (ownerId, path, content) => (await import("../persist.ts")).saveWorkspaceFile(ownerId, path, content)),
          }).then(outcome => {
            handle.receipts.push(outcome.receipt);
            if (outcome.change) {
              const before = handle.changes.get(outcome.change.path);
              handle.changes.set(outcome.change.path, { ...outcome.change, ...(before ? { before: before.before, beforeExists: before.beforeExists } : {}) });
            }
            if (outcome.ok) reply(message.id, outcome.result);
            else fail(message.id, outcome.error || "File operation failed.");
          }).catch(() => fail(message.id, "The file operation could not be verified."));
          handle.clientPending.add(request);
          void request.finally(() => handle.clientPending.delete(request));
        } else {
          handle.receipts.push({ method: message.method, status: "denied", detail: "This coding request is unavailable in this workspace." });
          fail(message.id, "That coding request is not available in this hosted workspace.");
        }
        continue;
      }
      if (message.method === "session/update") {
        const params = isObject(message.params) ? message.params : {};
        if (params.sessionUpdate === "agent_message_chunk") {
          const text = textFrom(params);
          if (text) appendCodingOutput(handle, text);
        }
        continue;
      }
      if (typeof message.id === "number") {
        const resolve = handle.pending.get(message.id);
        if (!resolve) continue;
        handle.pending.delete(message.id);
        resolve(message);
      }
    }
  });
}

async function openLiveSession(cwd: string, resumeSessionId?: string, ownerId = "dev-user"): Promise<{ handle: LiveHandle; sessionId: string; reused: boolean; error?: string }> {
  const existing = resumeSessionId ? liveSessions.get(resumeSessionId) : undefined;
  if (existing && !existing.closed && existing.child.exitCode == null && existing.cwd === cwd) {
    if (existing.ownerId !== ownerId) return { handle: existing, sessionId: "", reused: false, error: "This coding session belongs to another account." };
    touchLive(existing);
    return { handle: existing, sessionId: resumeSessionId || "", reused: true };
  }
  const command = adrianBuildCommand();
  const child = spawn(process.execPath, [command, "acp"], { cwd, env: adrianBuildEnv(), stdio: ["pipe", "pipe", "pipe"] });
  const handle: LiveHandle = { child, cwd, pid: child.pid || 0, nextId: 1, buffer: "", output: "", outputCharacters: 0, outputComplete: true, receipts: [], changes: new Map(), clientPending: new Set(), ownerId, pending: new Map(), mode: "default", closed: false, queue: Promise.resolve(), calls: [], stderr: "" };
  handle.child.stderr?.on("data", (chunk: Buffer) => {
    handle.stderr = publicError(`${handle.stderr}${chunk.toString("utf8")}`).slice(-400);
  });
  attachLive(handle);
  const initialized = await sendLive(handle, "initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false }, clientInfo: { name: "adrian-os", version: "0.1" } });
  if (isObject(initialized.error) || handle.closed) {
    closeLive(handle);
    return { handle, sessionId: "", reused: false, error: publicError(isObject(initialized.error) ? String(initialized.error.message || "The coding process did not start.") : "The coding process closed during startup.") };
  }
  const mcpServers = mcpServersFor(cwd);
  const created = await sendLive(handle, resumeSessionId ? "session/load" : "session/new", resumeSessionId ? { sessionId: resumeSessionId, cwd, mcpServers } : { cwd, mcpServers });
  const sessionId = isObject(created.result) && typeof created.result.sessionId === "string" ? created.result.sessionId : "";
  if (!sessionId || isObject(created.error)) {
    closeLive(handle);
    const text = isObject(created.error) && typeof created.error.message === "string" ? created.error.message : "The coding session was not accepted.";
    return { handle, sessionId: "", reused: false, error: publicError(text) };
  }
  liveSessions.set(sessionId, handle);
  touchLive(handle);
  return { handle, sessionId, reused: false };
}

type HostedMcpServer =
  | { name: string; command: string; args: string[] }
  | { type: "http"; name: string; url: string };

function mcpServersFor(cwd: string): HostedMcpServer[] {
  const file = `${cwd}/.mcp.json`;
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { mcpServers?: Record<string, { command?: string; args?: string[]; url?: string }> };
    const servers: HostedMcpServer[] = [];
    for (const [name, server] of Object.entries(parsed.mcpServers || {})) {
      if (server.command) servers.push({ name, command: server.command, args: server.args || [] });
      else if (server.url?.startsWith("https://")) servers.push({ type: "http", name, url: server.url });
    }
    return servers;
  } catch {
    return [];
  }
}

export async function runCodingTurn(input: { prompt: string; cwd: string; mode?: CodingMode; resumeSessionId?: string; fork?: boolean; ownerId?: string; persistFile?: (ownerId: string, path: string, content: string) => Promise<boolean> }): Promise<CodingTurn> {
  const command = adrianBuildCommand();
  const mode = input.mode;
  const mcpServers = mcpServersFor(input.cwd);
  const empty: CodingTurn = {
    ok: false, command, mode, mcpServers: mcpServers.length, operationId: randomUUID(),
    verification: { implementation: "unverified", builderInstructionDigest: createHash("sha256").update(ADRIAN_OS_BUILDER_ORDER).digest("hex"), checks: [{ id: "build", status: "not_run" }, { id: "regression_tests", status: "not_run" }, { id: "acceptance", status: "not_run" }] },
  };
  if (!command.endsWith(".mjs") && !command.endsWith(".js")) return { ...empty, error: "The in-repo coding package was not found." };
  const opened = await openLiveSession(input.cwd, input.resumeSessionId, input.ownerId);
  if (opened.error || !opened.sessionId) return { ...empty, error: opened.error || "The coding session was not accepted." };
  const run = async (): Promise<CodingTurn> => {
    const { handle, sessionId, reused } = opened;
    handle.output = "";
    handle.outputCharacters = 0;
    handle.outputComplete = true;
    handle.calls = [];
    handle.receipts = [];
    handle.changes.clear();
    handle.persistFile = input.persistFile;
    let requestDispatched = false;
    const receiptForTurn = (outcome: Partial<CodingTurn>): CodingTurn => {
      const warnings = handle.receipts.filter(receipt => receipt.status !== "succeeded" && receipt.method !== "session/request_permission").map(receipt => `${receipt.method}${receipt.path ? ` (${receipt.path})` : ""}: ${receipt.detail || receipt.status}`);
      if (warnings.length) appendCodingOutput(handle, `\n\nTool outcome warnings:\n${warnings.join("\n")}`);
      return {
        ...empty, sessionId, resumed: Boolean(input.resumeSessionId), reused, mode: handle.mode,
        processAlive: !handle.closed && handle.child.exitCode == null, pid: handle.pid, requestDispatched,
        clientCalls: [...handle.calls], toolReceipts: [...handle.receipts],
        filesChanged: [...handle.changes.values()].filter(change => !change.beforeExists || change.before !== change.after),
        outputCharacters: handle.outputCharacters, outputComplete: handle.outputComplete,
        processNote: handle.stderr.trim().slice(0, 240),
        output: (handle.output.trim() || (handle.receipts.some(receipt => receipt.method === "fs/write_text_file" && receipt.status === "succeeded") ? "A workspace file write was verified. Implementation verification is still pending." : outcome.ok ? "The coding request completed. No file write or implementation completion was verified." : "The coding request did not complete. Review the recorded tool outcomes before retrying.")) + (handle.outputComplete ? "" : "\n[Output exceeded the 1,000,000-character supported limit. This result is incomplete; do not treat it as full verification evidence.]"),
        ...outcome,
      };
    };
    if (mode && mode !== handle.mode) {
      const changed = await sendLive(handle, "session/set_mode", { sessionId, modeId: mode });
      if (isObject(changed.error)) return receiptForTurn({ error: `Mode change was not acknowledged. No task was dispatched. ${publicError(String(changed.error.message || ""))}` });
      handle.mode = mode;
    }
    if (handle.closed || !handle.child.stdin || handle.child.stdin.destroyed) return receiptForTurn({ error: "The coding process is not accepting requests. No task was dispatched." });
    requestDispatched = true;
    const prompted = await sendLive(handle, "session/prompt", { sessionId, prompt: [{ type: "text", text: `${ADRIAN_OS_BUILDER_ORDER}\n\n${input.prompt}` }] });
    await Promise.allSettled([...handle.clientPending]);
    if (handle.closed) return receiptForTurn({ error: "The coding process closed before the reply. Recorded changes were retained; completion was not assumed." });
    if (isObject(prompted.error)) {
      const text = typeof prompted.error.message === "string" ? prompted.error.message : "The coding task was not accepted.";
      return receiptForTurn({ error: publicError(text) });
    }
    const text = textFrom(prompted.result).trim();
    if (text && !handle.output.trimEnd().endsWith(text)) appendCodingOutput(handle, `${text}\n`);
    let forkedSessionId: string | undefined;
    if (input.fork) {
      const forked = await sendLive(handle, "session/fork", { sessionId, cwd: input.cwd, mcpServers });
      forkedSessionId = isObject(forked.result) && typeof forked.result.sessionId === "string" ? forked.result.sessionId : undefined;
      if (forkedSessionId) liveSessions.set(forkedSessionId, handle);
      if (!forkedSessionId) {
        const message = isObject(forked.error) && typeof forked.error.message === "string" ? forked.error.message : "The session was not forked.";
        return receiptForTurn({ error: publicError(message) });
      }
    }
    touchLive(handle);
    return receiptForTurn({ ok: true, forkedSessionId });
  };
  const turn = opened.handle.queue.then(run, run);
  opened.handle.queue = turn.then(() => undefined, () => undefined);
  return await turn;
}
