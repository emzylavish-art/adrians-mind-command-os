import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { requireUserId } from "../../auth/verify.server.ts";
import { assertSameOrigin } from "../connectors/oauth-csrf.ts";
import { adrianHostedWorkspace } from "./hosted/acp-client.ts";

const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");
const SECRET = /(^|\/)\.env($|\.)|(^|\/)credentials?\.(json|txt|pem)$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function workspaceFile(relativePath: string): string | null {
  const clean = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => part === ".." || part === ".git") || SECRET.test(clean)) return null;
  const root = adrianHostedWorkspace();
  const target = resolve(root, clean);
  if (target !== root && !target.startsWith(`${root}/`)) return null;
  return target;
}

function offsetAt(text: string, line: number, column: number): number {
  const lines = text.split("\n");
  const row = Math.max(1, Math.min(line, lines.length));
  let offset = 0;
  for (let index = 0; index < row - 1; index += 1) offset += lines[index].length + 1;
  return offset + Math.max(0, Math.min(column, lines[row - 1]?.length ?? 0));
}

export function completeSource(path: string, text: string, line: number, column: number): string[] {
  const fileName = /\.(tsx?|jsx?|mjs)$/i.test(path) ? path : "file.ts";
  const options: import("typescript").CompilerOptions = {
    allowJs: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  };
  const host: import("typescript").LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => (name === fileName ? ts.ScriptSnapshot.fromString(text) : undefined),
    getCurrentDirectory: () => "/",
    getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const service = ts.createLanguageService(host);
  const offset = offsetAt(text, line, column);
  const prefix = text.slice(Math.max(0, offset - 40), offset).match(/[A-Za-z_$][\w$]*$/)?.[0] ?? "";
  const info = service.getCompletionsAtPosition(fileName, offset, undefined);
  const names = (info?.entries ?? []).map((entry) => entry.name).filter((name) => !name.startsWith("_"));
  const matched = prefix ? names.filter((name) => name.toLowerCase().startsWith(prefix.toLowerCase())) : names;
  return (matched.length ? matched : names).slice(0, 8);
}

type LocalValue = { name: string; value: string };

export async function debugSourceFile(file: string, line: number): Promise<{ ok: true; pausedLine: number; locals: LocalValue[] } | { ok: false; error: string }> {
  if (!existsSync(file)) return { ok: false, error: "That file is not in the hosted workspace. Nothing was debugged." };
  const child = spawn(process.execPath, ["--inspect-brk=127.0.0.1:0", file], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  const stop = () => {
    if (child.exitCode == null) child.kill("SIGKILL");
  };
  try {
    const url = await new Promise<string>((resolveUrl, reject) => {
      const timer = setTimeout(() => reject(new Error("The debugger did not open. Nothing was paused.")), 5000);
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        const match = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9-]+/);
        if (match) {
          clearTimeout(timer);
          resolveUrl(match[0]);
        }
      });
      child.on("exit", () => {
        clearTimeout(timer);
        reject(new Error("The file exited before the debugger attached. Nothing was paused."));
      });
    });
    const socket = new WebSocket(url);
    await new Promise<void>((resolveOpen, reject) => {
      const timer = setTimeout(() => reject(new Error("The debugger socket did not open.")), 4000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolveOpen(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("The debugger socket failed.")); }, { once: true });
    });
    let nextId = 0;
    const pending = new Map<number, (message: { result?: { result?: Array<{ name?: string; value?: { value?: unknown; description?: string } }> } }) => void>();
    const events: Array<{ method?: string; params?: { scriptId?: string; url?: string; callFrames?: Array<{ location?: { lineNumber?: number }; scopeChain?: Array<{ type?: string; object?: { objectId?: string } }> }> } }> = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; method?: string; params?: (typeof events)[number]["params"]; result?: { result?: Array<{ name?: string; value?: { value?: unknown; description?: string } }> } };
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
      if (message.method) events.push({ method: message.method, params: message.params });
    });
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<{ result?: { result?: Array<{ name?: string; value?: { value?: unknown; description?: string } }> } }>((resolveSend, rejectSend) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectSend(new Error("The debugger did not answer. Nothing was paused."));
      }, 4000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolveSend(message);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const waitFor = async (predicate: (event: (typeof events)[number]) => boolean, ms = 4000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const found = events.find(predicate);
        if (found) return found;
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      return null;
    };
    await send("Debugger.enable");
    await send("Runtime.runIfWaitingForDebugger");
    const parsed = await waitFor((event) => event.method === "Debugger.scriptParsed" && String(event.params?.url || "").endsWith(`/${file.split("/").at(-1)}`));
    const wanted = Math.max(0, line - 1);
    if (parsed?.params?.scriptId) await send("Debugger.setBreakpoint", { location: { scriptId: parsed.params.scriptId, lineNumber: wanted } });
    await send("Debugger.resume");
    const paused = await waitFor((event) => event.method === "Debugger.paused" && event.params?.callFrames?.[0]?.location?.lineNumber === wanted, 3000);
    const pause = paused?.params ?? null;
    const frame = pause?.callFrames?.[0];
    const scope = frame?.scopeChain?.find((item) => item.type === "local") ?? frame?.scopeChain?.[0];
    const locals: LocalValue[] = [];
    if (scope?.object?.objectId) {
      const properties = await send("Runtime.getProperties", { objectId: scope.object.objectId });
      for (const item of properties.result?.result ?? []) {
        if (!item.name || item.name.startsWith("__")) continue;
        const value = item.value?.value ?? item.value?.description;
        if (value === undefined) continue;
        locals.push({ name: item.name, value: String(value) });
      }
    }
    socket.close();
    stop();
    if (!frame) return { ok: false, error: "The breakpoint was not reached. Nothing was paused." };
    return { ok: true, pausedLine: (frame.location?.lineNumber ?? line - 1) + 1, locals: locals.slice(0, 8) };
  } catch (error) {
    stop();
    return { ok: false, error: error instanceof Error ? error.message : "The debugger did not pause." };
  }
}

export async function handleIdeTools(request: Request): Promise<Response> {
  try {
    await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined);
  } catch {
    return json({ ok: false, error: "Sign in is required." }, 401);
  }
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const origin = assertSameOrigin(request);
  if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
  const body = await request.json().catch(() => ({})) as { action?: unknown; path?: unknown; text?: unknown; line?: unknown; column?: unknown };
  const relativePath = typeof body.path === "string" ? body.path : "";
  const target = workspaceFile(relativePath);
  if (!target) return json({ ok: false, error: "That file is outside the hosted workspace or is secret. Nothing ran." }, 400);
  if (body.action === "complete") {
    const text = typeof body.text === "string" ? body.text.slice(0, 200_000) : existsSync(target) ? readFileSync(target, "utf8").slice(0, 200_000) : "";
    const line = typeof body.line === "number" ? body.line : text.split("\n").length;
    const column = typeof body.column === "number" ? body.column : text.split("\n").at(-1)?.length ?? 0;
    return json({ ok: true, completions: completeSource(relativePath, text, line, column) });
  }
  if (body.action === "debug") {
    const line = typeof body.line === "number" ? body.line : 1;
    const result = await debugSourceFile(target, line);
    return json(result, result.ok ? 200 : 422);
  }
  return json({ ok: false, error: "Unsupported IDE action." }, 400);
}
