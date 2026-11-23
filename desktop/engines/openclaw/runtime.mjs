import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const ROOT = "desktop/engines/openclaw";
export const REVIEW = "desktop/engines/local-model/review";
export const MIND_PORTS = new Set([8765, 8766, 9222, 9400]);

export function layout(root) {
  return {
    root,
    memory: path.join(root, "memory"),
    queue: path.join(root, "queue"),
    output: path.join(root, "output"),
    logs: path.join(root, "logs"),
    skills: path.join(root, "skills"),
    jobs: path.join(root, "jobs"),
    workspaces: path.join(root, "workspaces"),
    envFile: path.join(root, "openclaw.env"),
    brainFile: path.join(root, "brain.json"),
  };
}

export function ensureLayout(root) {
  const dirs = layout(root);
  for (const key of ["memory", "queue", "output", "logs", "skills", "jobs", "workspaces"]) mkdirSync(dirs[key], { recursive: true });
  return dirs;
}

const ALLOWED_COMMANDS = new Set(["echo", "dir"]);

export function setBrain(file, input) {
  if (input.key) return { refused: "The key stays in the env file." };
  if (!input.baseUrl || !input.model || !input.keyEnv) return { refused: "A brain needs a base URL, model, and env key name." };
  const body = { baseUrl: input.baseUrl, model: input.model, keyEnv: input.keyEnv };
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return body;
}

export function loadSkills(dirs) {
  return readdirSync(dirs.skills).filter((name) => name.endsWith(".md") || name.endsWith("SKILL.md"));
}

export function paperclipTask(dirs, id, text) {
  const file = path.join(dirs.jobs, `${id}.json`);
  writeFileSync(file, `${JSON.stringify({ id, text, state: "queued" })}\n`);
  return file;
}

export function proposeSend(dirs, botId, channel, text) {
  const file = path.join(dirs.output, `${Date.now()}-${botId}-approval.json`);
  writeFileSync(file, `${JSON.stringify({ botId, channel, text, send: false, reason: "approval-required" })}\n`);
  return { file, sent: false };
}

export function allowCommand(command) {
  const name = command.trim().split(/\s+/)[0];
  if (!ALLOWED_COMMANDS.has(name)) return { refused: "That command is not on the allowlist." };
  return { allowed: name };
}

export function backoffMs(attempt) {
  if (!Number.isInteger(attempt) || attempt < 1) return 1000;
  return Math.min(30000, 1000 * 2 ** (attempt - 1));
}

export function writeEnvFile(file, entries) {
  const lines = Object.entries(entries).map(([key, value]) => `${key}=${value}`);
  writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return { path: file, mode: 0o600, keys: Object.keys(entries) };
}

export function logLine(dirs, botId, kind, text) {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dirs.logs, `${day}.log`);
  const line = `${new Date().toISOString()} ${botId} ${kind} ${text.replace(/[\r\n]/g, " ")}`;
  if (/=/.test(text) && /key|token|secret/i.test(text)) return { refused: "Secrets are not written to logs." };
  writeFileSync(file, `${line}\n`, { flag: "a" });
  return { file, line };
}

export function remember(dirs, botId, channel, thread, text) {
  const file = path.join(dirs.memory, `${botId}-${channel}-${thread}.json`);
  const prior = exists(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  prior.push({ at: new Date().toISOString(), text });
  writeFileSync(file, `${JSON.stringify(prior, null, 2)}\n`);
  return file;
}

export function wipeMemory(file) {
  rmSync(file, { force: true });
  return { wiped: file };
}

export function enqueue(dirs, botId, text) {
  const at = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dirs.queue, `${at}-${botId}.json`);
  writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), botId, text })}\n`);
  return file;
}

export function pollQueue(dirs) {
  return readdirSync(dirs.queue).filter((name) => name.endsWith(".json")).sort();
}

export function finishJob(dirs, name, result) {
  const job = JSON.parse(readFileSync(path.join(dirs.queue, name), "utf8"));
  const out = path.join(dirs.output, name);
  writeFileSync(out, `${JSON.stringify({ ...job, result, finished: new Date().toISOString() }, null, 2)}\n`);
  rmSync(path.join(dirs.queue, name));
  return out;
}

export function sandboxPath(dirs, botId, target) {
  const base = path.resolve(dirs.workspaces, botId);
  const full = path.resolve(base, target);
  if (full !== base && !full.startsWith(`${base}${path.sep}`)) return { refused: "Sandbox blocks that path." };
  return { allowed: full };
}

export function bindAdmin(explicit) {
  if (explicit === true) return { host: "0.0.0.0", refused: "Remote admin is not opened by this contract." };
  return { host: "127.0.0.1", remote: false };
}

export function health(dirs, started) {
  return {
    status: "ok",
    host: "127.0.0.1",
    uptimeMs: Date.now() - started,
    activeBots: readdirSync(dirs.workspaces).length,
    queueDepth: pollQueue(dirs).length,
    lastError: null,
  };
}

export function reviewProposal(botId, text) {
  const at = new Date().toISOString().replace(/[:.]/g, "-");
  return { folder: REVIEW, file: `${at}-openclaw-${botId}.md`, body: `# OpenClaw proposal\n\n- at: ${new Date().toISOString()}\n- bot: ${botId}\n\n${text}\n` };
}

export function restartNote(botId, reason) {
  return `${new Date().toISOString()} ${botId} restart ${reason}`;
}

export function portAllowed(port) {
  return Number.isInteger(port) && port >= 1024 && port <= 65535 && !MIND_PORTS.has(port);
}

function exists(file) {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}
