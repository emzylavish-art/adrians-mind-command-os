import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { resolveXaiInferenceApiKey } from "../../media/xai-key.ts";
import { installCodingExtensions } from "./coding-extensions.server.ts";
import { codingSearchUrl } from "./coding-search-bridge.server.ts";

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
  const home = process.env.KIMI_CODE_HOME || "/tmp/adrian-build-home";
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
  return resolve(process.env.ADRIAN_BUILD_WORKSPACE || "/tmp/adrian-build-workspace");
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
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "adrian-os", version: "0.1" } } })}\n`);
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
  forkedSessionId?: string;
  output?: string;
  error?: string;
  mcpServers: number;
};

function mcpServersFor(cwd: string): { name: string; command?: string; args?: string[]; type?: "http"; url?: string }[] {
  const file = `${cwd}/.mcp.json`;
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { mcpServers?: Record<string, { command?: string; args?: string[]; url?: string }> };
    return Object.entries(parsed.mcpServers || {}).flatMap(([name, server]) => {
      if (server.command) return [{ name, command: server.command, args: server.args || [] }];
      if (server.url?.startsWith("https://")) return [{ type: "http" as const, name, url: server.url }];
      return [];
    });
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
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [command, "acp"], { cwd: input.cwd, env: adrianBuildEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let settled = false;
    let output = "";
    let stderr = "";
    let sessionId = input.resumeSessionId || "";
    const finish = (turn: CodingTurn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(turn);
    };
    const send = (id: number, method: string, params: JsonObject) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    };
    const timer = setTimeout(() => finish({ ...empty, sessionId, output, ok: Boolean(output), error: output ? undefined : publicError(stderr || "The coding package did not finish the task within 120 seconds.") }), 120_000);
    child.on("error", (error) => finish({ ...empty, error: error.message }));
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = publicError(`${stderr}${chunk.toString("utf8")}`).slice(0, 300);
    });
    send(1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "adrian-os", version: "0.1" } });
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: JsonObject;
        try { message = JSON.parse(line) as JsonObject; } catch { continue; }
        if (message.method === "session/update") {
          const text = textFrom(message.params).trim();
          if (text) output = `${output}${text}\n`.slice(0, 4000);
        }
        if (typeof message.method === "string" && message.id != null) {
          const allow = mode === "auto" || mode === "yolo";
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: message.method === "session/request_permission" ? { outcome: { outcome: allow ? "selected" : "cancelled", optionId: allow ? "allow-once" : undefined } } : {} })}\n`);
        }
        if (message.id === 1) {
          if (sessionId) send(2, "session/load", { sessionId, cwd: input.cwd, mcpServers });
          else send(2, "session/new", { cwd: input.cwd, mcpServers });
        }
        if (message.id === 2) {
          if (isObject(message.error)) {
            const text = typeof message.error.message === "string" ? message.error.message : "The coding session was not accepted.";
            finish({ ...empty, error: publicError(text) });
            return;
          }
          if (isObject(message.result) && typeof message.result.sessionId === "string") sessionId = message.result.sessionId;
          if (mode) send(4, "session/set_mode", { sessionId, modeId: mode });
          else send(3, "session/prompt", { sessionId, prompt: [{ type: "text", text: input.prompt }] });
        }
        if (message.id === 4) {
          if (isObject(message.error)) {
            const text = typeof message.error.message === "string" ? message.error.message : "The coding mode was not accepted.";
            output = `${output}Mode was not changed: ${publicError(text)}\n`.slice(0, 4000);
          }
          send(3, "session/prompt", { sessionId, prompt: [{ type: "text", text: input.prompt }] });
        }
        if (message.id === 3) {
          if (isObject(message.error)) {
            const text = typeof message.error.message === "string" ? message.error.message : "The coding task was not accepted.";
            finish({ ...empty, sessionId, output, error: publicError(text) });
            return;
          }
          const text = textFrom(message.result).trim();
          if (text) output = `${output}${text}\n`.slice(0, 4000);
          if (input.fork && sessionId) send(5, "session/fork", { sessionId, cwd: input.cwd, mcpServers });
          else finish({ ...empty, ok: true, sessionId, resumed: Boolean(input.resumeSessionId), output: output.trim() || "The coding package accepted the task." });
        }
        if (message.id === 5) {
          const forked = isObject(message.result) && typeof message.result.sessionId === "string" ? message.result.sessionId : undefined;
          if (!forked) {
            const text = isObject(message.error) && typeof message.error.message === "string" ? message.error.message : "The session was not forked.";
            finish({ ...empty, sessionId, output, error: publicError(text) });
            return;
          }
          finish({ ...empty, ok: true, sessionId, resumed: Boolean(input.resumeSessionId), forkedSessionId: forked, output: output.trim() || "The coding package forked the session." });
        }
      }
    });
  });
}
