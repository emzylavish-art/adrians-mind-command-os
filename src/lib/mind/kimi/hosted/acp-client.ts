import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { resolveXaiInferenceApiKey } from "../../media/xai-key.ts";
import { installCodingExtensions } from "./coding-extensions.server.ts";
import { codingSearchUrl } from "./coding-search-bridge.server.ts";
import { ADRIAN_OS_BUILDER_ORDER } from "../../adrian-os-skill.ts";

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
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function publicError(text: string): string {
  return text.replace(/xai-[A-Za-z0-9_-]{8,}/g, "[saved key]").replace(/sk-[A-Za-z0-9_-]{8,}/g, "[saved key]").slice(0, 400);
}

function workspaceFile(cwd: string, requested: unknown): string | null {
  if (typeof requested !== "string" || !requested.trim() || requested.includes("\0")) return null;
  const root = resolve(cwd);
  const target = resolve(requested.startsWith("/") ? requested : resolve(root, requested));
  if (target !== root && !target.startsWith(`${root}/`)) return null;
  const relativePath = target.slice(root.length + 1);
  if (!relativePath || relativePath.split("/").includes(".git") || /(^|\/)\.env($|\.)|(^|\/)credentials?\.(json|txt|pem)$/i.test(relativePath)) return null;
  return target;
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

export function adrianBuildEnv(): NodeJS.ProcessEnv {
  const key = resolveXaiInferenceApiKey();
  const home = process.env.KIMI_CODE_HOME || join(process.cwd(), ".data", "adrian-build-home");
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
    KIMI_MODEL_NAME: "grok-4.20-0309-non-reasoning",
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
  const dir = resolve(process.env.ADRIAN_BUILD_WORKSPACE || join(process.cwd(), ".data", "adrian-build-workspace"));
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
    const seen: KimiProbe & { output?: string } = { status: "failed", command, runtimeVerified: false };
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
            else child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: { sessionId, prompt: [{ type: "text", text: prompts[0] }] } })}\n`);
          } else {
            finish({ ...seen, status: "session_created", error: undefined });
          }
        }
        if (message.method === "session/update") {
          const text = textFrom(message.params).trim();
          if (text) seen.output = `${seen.output || ""}${text}`.slice(0, 4000);
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
};

type LiveHandle = {
  child: ReturnType<typeof spawn>;
  cwd: string;
  pid: number;
  nextId: number;
  buffer: string;
  output: string;
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
          const kinds = allow ? ["allow_always", "allow_once"] : ["reject_once", "reject_always"];
          const match = options.find((option) => kinds.includes(String(option.kind)));
          reply(message.id, match && typeof match.optionId === "string" ? { outcome: { outcome: "selected", optionId: match.optionId } } : { outcome: { outcome: "cancelled" } });
        } else if (message.method === "fs/read_text_file") {
          const target = workspaceFile(handle.cwd, params.path);
          if (!target) fail(message.id, "That file is outside the hosted workspace or is secret. Nothing was read.");
          else {
            const content = existsSync(target) ? readFileSync(target, "utf8") : "";
            const line = typeof params.line === "number" ? params.line : 0;
            const limit = typeof params.limit === "number" ? params.limit : content.split("\n").length;
            reply(message.id, { content: content.split("\n").slice(line, line + limit).join("\n").slice(0, 20_000) });
          }
        } else if (message.method === "fs/write_text_file") {
          const target = workspaceFile(handle.cwd, params.path);
          if (!allow) fail(message.id, "File writes stay off until the task runs in auto mode. Nothing was written.");
          else if (!target || typeof params.content !== "string" || params.content.length > 1_000_000) fail(message.id, "That write is outside the hosted workspace, secret, or too large. Nothing was written.");
          else {
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, params.content);
            const savedPath = relative(handle.cwd, target);
            const content = params.content;
            if (!process.env.DATABASE_URL && typeof content === "string") void import("../persist.ts").then((mod) => mod.saveWorkspaceFile("dev-user", savedPath, content)).catch(() => undefined);
            reply(message.id, {});
          }
        } else {
          fail(message.id, "That coding request is not available in this hosted workspace.");
        }
        continue;
      }
      if (message.method === "session/update") {
        const params = isObject(message.params) ? message.params : {};
        if (params.sessionUpdate === "agent_message_chunk") {
          const text = textFrom(params);
          if (text) handle.output = `${handle.output}${text}`.slice(0, 4000);
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

async function openLiveSession(cwd: string, resumeSessionId?: string, mode?: CodingMode): Promise<{ handle: LiveHandle; sessionId: string; reused: boolean; error?: string }> {
  const existing = resumeSessionId ? liveSessions.get(resumeSessionId) : undefined;
  if (existing && !existing.closed && existing.child.exitCode == null && existing.cwd === cwd) {
    if (mode && mode !== existing.mode) {
      existing.mode = mode;
      const changed = await sendLive(existing, "session/set_mode", { sessionId: resumeSessionId, modeId: mode });
      if (isObject(changed.error)) existing.output = `${existing.output}Mode was not changed: ${publicError(String(changed.error.message || ""))}\n`.slice(0, 4000);
    }
    touchLive(existing);
    return { handle: existing, sessionId: resumeSessionId || "", reused: true };
  }
  const command = adrianBuildCommand();
  const child = spawn(process.execPath, [command, "acp"], { cwd, env: adrianBuildEnv(), stdio: ["pipe", "pipe", "pipe"] });
  const handle: LiveHandle = { child, cwd, pid: child.pid || 0, nextId: 1, buffer: "", output: "", pending: new Map(), mode, closed: false, queue: Promise.resolve(), calls: [], stderr: "" };
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
  if (mode) {
    const changed = await sendLive(handle, "session/set_mode", { sessionId, modeId: mode });
    if (isObject(changed.error)) handle.output = `Mode was not changed: ${publicError(String(changed.error.message || ""))}\n`;
  }
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

export async function runCodingTurn(input: { prompt: string; cwd: string; mode?: CodingMode; resumeSessionId?: string; fork?: boolean }): Promise<CodingTurn> {
  const command = adrianBuildCommand();
  const mode = input.mode;
  const mcpServers = mcpServersFor(input.cwd);
  const empty: CodingTurn = { ok: false, command, mode, mcpServers: mcpServers.length };
  if (!command.endsWith(".mjs") && !command.endsWith(".js")) return { ...empty, error: "The in-repo coding package was not found." };
  const opened = await openLiveSession(input.cwd, input.resumeSessionId, mode);
  if (opened.error || !opened.sessionId) return { ...empty, error: opened.error || "The coding session was not accepted." };
  const run = async (): Promise<CodingTurn> => {
    const { handle, sessionId, reused } = opened;
    handle.output = "";
    const prompted = await sendLive(handle, "session/prompt", { sessionId, prompt: [{ type: "text", text: `${ADRIAN_OS_BUILDER_ORDER}\n\n${input.prompt}` }] });
    if (handle.closed) return { ...empty, sessionId, error: "The coding process closed before the reply. Nothing further was assumed." };
    if (isObject(prompted.error)) {
      const text = typeof prompted.error.message === "string" ? prompted.error.message : "The coding task was not accepted.";
      return { ...empty, sessionId, pid: handle.pid, processAlive: handle.child.exitCode == null, reused, error: publicError(text) };
    }
    const text = textFrom(prompted.result).trim();
    if (text) handle.output = `${handle.output}${text}\n`.slice(0, 4000);
    let forkedSessionId: string | undefined;
    if (input.fork) {
      const forked = await sendLive(handle, "session/fork", { sessionId, cwd: input.cwd, mcpServers });
      forkedSessionId = isObject(forked.result) && typeof forked.result.sessionId === "string" ? forked.result.sessionId : undefined;
      if (forkedSessionId) liveSessions.set(forkedSessionId, handle);
      if (!forkedSessionId) {
        const message = isObject(forked.error) && typeof forked.error.message === "string" ? forked.error.message : "The session was not forked.";
        return { ...empty, sessionId, pid: handle.pid, processAlive: true, reused, error: publicError(message) };
      }
    }
    touchLive(handle);
    return {
      ...empty,
      ok: true,
      sessionId,
      resumed: Boolean(input.resumeSessionId),
      reused,
      processAlive: handle.child.exitCode == null,
      pid: handle.pid,
      forkedSessionId,
      clientCalls: handle.calls.slice(0, 12),
      processNote: handle.stderr.trim().slice(0, 240),
      output: handle.output.trim() || (handle.calls.includes("fs/write_text_file") ? "The coding process wrote a hosted file. The process is still running for this session." : "The coding package accepted the task. The process is still running for this session."),
    };
  };
  const turn = opened.handle.queue.then(run, run);
  opened.handle.queue = turn.then(() => undefined, () => undefined);
  return await turn;
}
