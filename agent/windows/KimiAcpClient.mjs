#!/usr/bin/env node
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { isAbsolute, relative, resolve } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i]?.startsWith("--")) args.set(process.argv[i].slice(2), process.argv[i + 1] ?? "");
}

const configPath = args.get("config");
const jobPath = args.get("job-json");
if (!configPath || !jobPath) {
  console.error("Usage: KimiAcpClient.mjs --config <config.json> --job-json <job.json>");
  process.exit(2);
}

const config = JSON.parse((await readFile(configPath, "utf8")).replace(/^\uFEFF/, ""));
const job = JSON.parse((await readFile(jobPath, "utf8")).replace(/^\uFEFF/, ""));
const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
const operation = typeof payload.operation === "string" ? payload.operation : "";
const allowedRoots = Array.isArray(config.allowedRoots) ? config.allowedRoots.filter((v) => typeof v === "string" && v.trim()) : [];
const root = resolve(String(payload.cwd || allowedRoots[0] || process.cwd()));
const kimiCommand = String(config.kimiPath || "kimi");
const dashboardUrl = String(config.dashboardUrl || "").replace(/\/$/, "");
const token = String(config.jobToken || (!config.tokenId && config.token) || "");

function isWithin(candidate, allowed) {
  const rel = relative(allowed, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function safePath(rawPath) {
  if (typeof rawPath !== "string" || !rawPath.trim()) return null;
  const candidate = resolve(root, rawPath);
  return isWithin(candidate, root) ? candidate : null;
}

async function post(path, body) {
  const response = await fetch(`${dashboardUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json().catch(() => ({}));
}

async function jobStatus() {
  const response = await fetch(`${dashboardUrl}/api/mind/pc/jobs?jobId=${encodeURIComponent(job.id)}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  return response.json();
}

async function event(type, payloadValue = {}) {
  try {
    await post("/api/mind/pc/events", { jobId: job.id, type, payload: payloadValue });
  } catch (error) {
    console.error(`event report failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Device + inode distinguish most same-name replacements; timestamps also catch
// edits and inode reuse. Keep the token opaque to the editor.
function fileRevision(info) {
  return createHash("sha256").update([info.dev, info.ino, info.birthtimeNs, info.ctimeNs, info.size].join(":")).digest("hex");
}

async function listWorkspace(directory, prefix = "", output = []) {
  if (output.length >= 500) return output;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".data") continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) await listWorkspace(fullPath, relativePath, output);
    else {
      const info = await stat(fullPath, { bigint: true });
      output.push({ path: relativePath, bytes: Number(info.size), revision: fileRevision(info) });
    }
    if (output.length >= 500) break;
  }
  return output;
}

async function runFileOperation() {
  await event("runtime_start", { kind: "file-op", operation, cwd: root });
  if (operation === "list") {
    const files = await listWorkspace(root);
    await event("file_list", { count: files.length });
    return JSON.stringify({ operation, cwd: root, files });
  }
  if (operation === "search") {
    const query = String(payload.query || "").toLowerCase();
    if (!query) throw new Error("Search query is required.");
    const matches = [];
    for (const file of await listWorkspace(root)) {
      if (matches.length >= 50) break;
      const full = safePath(file.path);
      if (!full || file.bytes > 200_000) continue;
      let text = "";
      try { text = await readFile(full, "utf8"); } catch { continue; }
      if (file.path.toLowerCase().includes(query) || text.toLowerCase().includes(query)) matches.push({ path: file.path, bytes: file.bytes });
    }
    await event("file_search", { count: matches.length });
    return JSON.stringify({ operation, cwd: root, query: payload.query, matches });
  }
  const path = safePath(payload.path);
  if (!path) throw new Error("Requested file path is outside the approved workspace.");
  if (operation === "rename" || operation === "delete") {
    if (payload.confirm !== true) throw new Error("Explicit confirmation is required.");
    const reviewed = fileRevision(await stat(path, { bigint: true }));
    if (typeof payload.expectedRevision === "string" && payload.expectedRevision !== reviewed) {
      throw new Error("The reviewed file changed or was replaced. Review the current file before continuing.");
    }
    if (operation === "delete") {
      await rm(path, { force: false });
      await event("file_delete", { path: payload.path });
      return JSON.stringify({ operation, cwd: root, path: payload.path, deleted: true });
    }
    const target = safePath(payload.to);
    if (!target) throw new Error("Rename target is outside the approved workspace.");
    await mkdir(resolve(target, ".."), { recursive: true });
    await rename(path, target);
    await event("file_rename", { from: payload.path, to: payload.to });
    return JSON.stringify({ operation, cwd: root, from: payload.path, to: payload.to });
  }
  if (operation === "read") {
    const revision = fileRevision(await stat(path, { bigint: true }));
    const content = await readFile(path, "utf8");
    if (fileRevision(await stat(path, { bigint: true })) !== revision) throw new Error("File changed during read. Reopen it.");
    if (content.length > 1_000_000) throw new Error("File exceeds the editor limit. The full file must be reviewed before editing.");
    await event("file_read", { path: payload.path, bytes: content.length });
    return JSON.stringify({ operation, cwd: root, path: payload.path, revision, content });
  }
  if (typeof payload.content !== "string" || payload.content.length > 1_000_000) throw new Error("File content is missing or too large.");
  let before = "";
  let exists = true;
  try {
    before = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    exists = false;
  }
  if (before.length > 1_000_000) throw new Error("Existing file exceeds the editor limit. Nothing was written.");
  if (payload.expectedMissing === true && exists) throw new Error("File already exists. Choose a new name.");
  if (typeof payload.expectedContent === "string" && (!exists || before !== payload.expectedContent)) {
    throw new Error("The file changed since it was opened. Review it before saving.");
  }
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, payload.content, { encoding: "utf8", flag: payload.expectedMissing === true ? "wx" : "w" });
  await event("file_write", { path: payload.path, bytes: payload.content.length, reviewed: true });
  return JSON.stringify({ operation, cwd: root, path: payload.path, revision: fileRevision(await stat(path, { bigint: true })), before, after: payload.content });
}

async function runShellOperation() {
  if (job.confirm !== true) throw new Error("Terminal execution requires an owner-approved job.");
  await event("terminal_start", { cwd: root, command: String(job.command || "").slice(0, 500) });
  const command = String(job.command || "").trim();
  if (!command) throw new Error("Terminal command is empty.");
  const executable = process.platform === "win32" ? "powershell.exe" : "sh";
  const args = process.platform === "win32" ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-lc", command];
  const processChild = spawn(executable, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let stderr = "";
  processChild.stdout.setEncoding("utf8");
  processChild.stderr.setEncoding("utf8");
  processChild.stdout.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-100_000); });
  processChild.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-20_000); });
  const result = await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { processChild.kill(); reject(new Error("Terminal command timed out after 120 seconds.")); }, 120_000);
    processChild.on("error", (error) => { clearTimeout(timer); reject(error); });
    processChild.on("exit", (code, signal) => { clearTimeout(timer); resolvePromise({ code: code ?? 1, signal }); });
  });
  await event("terminal_complete", { code: result.code, signal: result.signal || null, stdoutChars: stdout.length, stderrChars: stderr.length });
  const output = `${stdout}${stderr ? `\n${stderr}` : ""}`.slice(-120_000);
  if (result.code !== 0) throw new Error(`Command exited with code ${result.code}.\n${output}`.slice(0, 20_000));
  return output || "(empty output)";
}

let nextId = 1;
const pending = new Map();
let output = "";
let child;
let closed = false;
let cancellationTimer;

function send(message) {
  if (!child?.stdin.writable) throw new Error("Kimi ACP stdin is closed.");
  child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
}

function request(method, params, timeoutMs = 120_000) {
  const id = nextId++;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ACP method ${method}.`));
    }, timeoutMs);
    pending.set(id, { resolve: resolvePromise, reject, timer, method });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleAgentRequest(message) {
  const method = message.method;
  const params = message.params && typeof message.params === "object" ? message.params : {};
  if (method === "fs/read_text_file") {
    const path = safePath(params.path);
    if (!path) return respondError(message.id, -32003, "File path is outside the approved workspace.");
    try {
      const content = await readFile(path, "utf8");
      return respond(message.id, { content: content.slice(0, 1_000_000) });
    } catch (error) {
      return respondError(message.id, -32004, error instanceof Error ? error.message : "File read failed.");
    }
  }
  if (method === "fs/write_text_file") {
    // This worker has no ACP owner-approval bridge. Explicit reviewed file jobs
    // use runFileOperation and do not flow through an agent reverse request.
    return respondError(message.id, -32003, "Use a reviewed file operation to write to the paired workspace.");
  }
  if (method === "session/request_permission") {
    await event("permission_request", { request: params });
    return respond(message.id, { outcome: { outcome: "cancelled" } });
  }
  if (method === "terminal/create" || method === "terminal/output" || method === "terminal/release" || method === "terminal/kill" || method === "terminal/wait_for_exit") {
    await event("terminal_request", { method, request: params, decision: "denied" });
    return respondError(message.id, -32003, "ACP terminal execution requires the Adrian OS owner-approval terminal path.");
  }
  await event("unsupported_request", { method });
  return respondError(message.id, -32601, `Unsupported ACP client method: ${method}`);
}

async function main() {
  if (job.kind === "kimi-acp" && !prompt) throw new Error("Kimi job has no prompt.");
  if (job.kind === "file-op" && !["list", "read", "write", "search", "rename", "delete"].includes(operation)) throw new Error("Unsupported file operation.");
  if (!dashboardUrl || !token) throw new Error("Companion config is missing dashboardUrl or token.");
  if (!allowedRoots.some((allowed) => isWithin(root, resolve(allowed)))) {
    throw new Error("Requested Kimi workspace is outside the Companion allowed roots.");
  }

  if (job.kind === "shell") {
    const result = await runShellOperation();
    return result;
  }
  if (job.kind === "file-op") {
    const result = await runFileOperation();
    await event("session_complete", { kind: "file-op" });
    return result;
  }
  await event("runtime_start", { command: "kimi acp", cwd: root });
  child = spawn(kimiCommand, ["acp"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(kimiCommand),
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => console.error(String(chunk).trimEnd()));
  child.on("error", (error) => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  });
  child.on("exit", (code, signal) => {
    closed = true;
    if (cancellationTimer) clearInterval(cancellationTimer);
    if (code !== 0) for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`Kimi ACP exited with code=${code} signal=${signal || "none"}.`)); }
    if (code !== 0) console.error(`kimi acp exited with code=${code} signal=${signal || "none"}`);
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { await event("protocol_error", { detail: "Kimi stdout contained non-JSON output." }); return; }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message || `ACP ${item.method} failed.`));
      else item.resolve(message.result);
      return;
    }
    if (message.method === "session/update") {
      const update = message.params?.update && typeof message.params.update === "object" ? message.params.update : message.params || {};
      if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") output += String(update.content.text || "");
      await event("session_update", { update });
      return;
    }
    if (message.id !== undefined && message.method) await handleAgentRequest(message);
  });

  const initialized = await request("initialize", {
    protocolVersion: 1,
    clientInfo: { name: "Adrian OS Windows Companion", version: "1.0.0" },
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
  });
  await event("initialized", { agentInfo: initialized?.agentInfo || {}, agentCapabilities: initialized?.agentCapabilities || {} });
  const session = await request("session/new", { cwd: root, mcpServers: [], additionalDirectories: [] });
  const sessionId = session?.sessionId;
  if (!sessionId) throw new Error("Kimi ACP did not return a sessionId.");
  await event("session_created", { sessionId });
  cancellationTimer = setInterval(async () => {
    try {
      const status = await jobStatus();
      if (status?.job?.status === "cancel_requested" && child && !closed) {
        await event("session_cancelled", { sessionId });
        child.kill();
      }
    } catch { /* transient dashboard failure; the next poll retries */ }
  }, 1_000);
  await request("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] }, 900_000);
  await event("session_complete", { sessionId, outputChars: output.length });
  try { await request("session/close", { sessionId }, 30_000); } catch { /* best effort */ }
  child.stdin.end();
  if (!closed) child.kill();
  return output || "Kimi completed without an assistant text chunk.";
}

async function getReceipt(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function deliver() {
  const started = jobPath + ".started";
  const resultPath = jobPath + ".result";
  const existing = await getReceipt(resultPath);
  let result;
  if (existing !== null) {
    result = JSON.parse(existing);
    if (result.jobId !== job.id) throw new Error("Mismatched local result receipt.");
  } else {
    try {
      await writeFile(started, JSON.stringify({ jobId: job.id, pid: process.pid }), { flag: "wx", mode: 0o600, flush: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const previous = JSON.parse(await readFile(started, "utf8"));
      if (previous.jobId !== job.id) throw new Error("Mismatched local start receipt.");
      try {
        process.kill(previous.pid, 0);
        throw new Error("The previous worker may still be active. Waiting for its result.");
      } catch (probeError) {
        if (probeError.code !== "ESRCH") throw probeError;
      }
      result = { jobId: job.id, ok: false, error: "The worker stopped before recording the outcome. Check the workspace before retrying; this job was not repeated." };
    }
    if (!result) {
      try {
        const status = await jobStatus();
        if (status?.job?.status !== "running") throw new Error("Job is no longer active or its status could not be verified.");
        result = { jobId: job.id, ok: true, output: await main() };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await event("runtime_error", { error: message });
        result = { jobId: job.id, ok: false, error: message };
      }
    }
    await writeFile(resultPath + ".new", JSON.stringify(result), { mode: 0o600, flush: true });
    await rename(resultPath + ".new", resultPath);
  }
  const ack = await post("/api/mind/pc/result", result);
  if (!ack.ok) throw new Error("Dashboard did not acknowledge the saved outcome.");
}

try { await deliver(); }
catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
