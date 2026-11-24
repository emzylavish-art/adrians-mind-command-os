import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLayout, inboundMessage, portAllowed, proposeSend, setBrain } from "./runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function line(status, name, detail) {
  return { status, name, detail };
}

export function checkBoot(env) {
  if (env.platform !== "win32") return line("BLOCKED", "boot", "A clean Windows login is required to exercise the scheduled worker.");
  if (env.taskRegistered == null) return line("BLOCKED", "boot", "Windows Task Scheduler could not be queried. Verify access under the installed user account.");
  if (!env.taskRegistered) return line("FAIL", "boot", "AdriansMind-Agents is not registered. The login task from Register-Autostart.ps1 was not found.");
  if (env.processRunning == null) return line("BLOCKED", "boot", "The installed runtime process could not be inspected. Verify access to process command lines.");
  if (!env.processRunning) return line("FAIL", "boot", "The Adrian agents process is not running after login.");
  return line("BLOCKED", "boot", "Task registration and the runtime process were observed. Login provenance, sustained health and a completed worker job still need verification.");
}

export function readBootProbe(taskRegistered, commandLines, runtimePath) {
  if (commandLines == null) return { taskRegistered, processRunning: null };
  const expected = path.win32.normalize(runtimePath).toLowerCase();
  const processRunning = commandLines.split(/\r?\n/).some((line) => {
    const match = line.trim().match(/^(?:"([^"]+)"|(\S+))\s+(?:"([^"]+)"|([^"\s]+))$/);
    if (!match) return false;
    const executable = path.win32.basename(match[1] || match[2]).toLowerCase();
    const script = path.win32.normalize(match[3] || match[4]).toLowerCase();
    return executable === "node.exe" && script === expected;
  });
  return { taskRegistered, processRunning };
}

export function readWindowsBoot(platform = process.platform) {
  if (platform !== "win32") return { taskRegistered: false, processRunning: false };
  let taskRegistered = null;
  let commandLines = null;
  try {
    const names = execFileSync("powershell", ["-NoProfile", "-Command", "$ErrorActionPreference = 'Stop'; Get-ScheduledTask -TaskPath '\\' | Select-Object -ExpandProperty TaskName"], { encoding: "utf8" });
    taskRegistered = names.split(/\r?\n/).some((name) => name.trim().toLowerCase() === "adriansmind-agents");
  } catch {
    // Keep an unavailable scheduler distinct from a missing task.
  }
  try {
    commandLines = execFileSync("powershell", ["-NoProfile", "-Command", "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object -ExpandProperty CommandLine"], { encoding: "utf8" });
  } catch {
    // An unreadable command line cannot establish runtime identity.
  }
  return readBootProbe(taskRegistered, commandLines, path.join(here, "runtime.mjs"));
}

export function checkApproval(dirs) {
  const draft = proposeSend(dirs, "telegram-test", "telegram", "draft reply");
  const saved = JSON.parse(readFileSync(draft.file, "utf8"));
  if (draft.sent !== false || saved.send !== false) return line("FAIL", "approval", "The draft was not held in the approval queue.");
  return line("BLOCKED", "approval", "A local draft was held. The installed approval handler must still execute a controlled approved effect once and reject replay.");
}

export function checkBrainSwap(dirs, codeBefore) {
  setBrain(dirs.brainFile, { baseUrl: "http://127.0.0.1:11434/v1", model: "first-model", keyEnv: "BRAIN_KEY" });
  setBrain(dirs.brainFile, { baseUrl: "http://127.0.0.1:11434/v1", model: "second-model", keyEnv: "BRAIN_KEY" });
  const saved = JSON.parse(readFileSync(dirs.brainFile, "utf8"));
  const codeAfter = createHash("sha256").update(readFileSync(path.join(here, "runtime.mjs"))).digest("hex");
  if (saved.model !== "second-model" || codeBefore !== codeAfter) return line("FAIL", "brain-swap", "The brain swap changed code or did not save the new model.");
  if (!saved.keyEnv || saved.key) return line("FAIL", "brain-swap", "The brain file must name an env key and must not store the key.");
  return line("BLOCKED", "brain-swap", "The test configuration saved the replacement model. Live inference before and after the switch still needs verification on the installed worker.");
}

export function checkCoexistence(env) {
  if (!portAllowed(8787) || portAllowed(9400)) return line("FAIL", "coexistence", "Adrian agents port 8787 must stay clear of the Mind OS ports.");
  if (env.workerThreads > 2 || env.memoryCeilingMb > 1024) return line("FAIL", "coexistence", "The cap is above 2 threads or 1024 MB.");
  if (env.platform !== "win32") return line("BLOCKED", "coexistence", "Concurrent process and responsiveness measurements require the Windows PC.");
  const missing = [];
  if (!env.paperclipRunning) missing.push("Paperclip");
  if (!env.runnerRunning) missing.push("local runner");
  if (!env.tradingLoopRunning) missing.push("trading loop");
  if (missing.length) return line("BLOCKED", "coexistence", `Concurrent operation still needs verification for ${missing.join(", ")}.`);
  return line("BLOCKED", "coexistence", "The reported processes and configured caps still need CPU, memory and responsiveness measurements under a representative load.");
}

export function checkDeleteRefusal(dirs) {
  const result = inboundMessage(dirs, "telegram-test", "delete all files");
  if (result.refused !== "Untrusted channel text cannot delete files.") return line("FAIL", "delete-refusal", "The delete instruction was not refused.");
  const log = readFileSync(result.logged, "utf8");
  if (!log.includes("refused") || !log.includes("telegram-test")) return line("FAIL", "delete-refusal", "The refusal was not logged with the bot id.");
  return line("BLOCKED", "delete-refusal", "The local helper refused and logged the fixture. The installed execution boundary still needs an isolated test with a disposable file.");
}

export function runChecks(env) {
  const dirs = ensureLayout(env.root);
  const codeBefore = createHash("sha256").update(readFileSync(path.join(here, "runtime.mjs"))).digest("hex");
  return [
    checkBoot(env),
    checkApproval(dirs),
    checkBrainSwap(dirs, codeBefore),
    checkCoexistence(env),
    checkDeleteRefusal(dirs),
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = mkdtempSync(path.join(tmpdir(), "adrian-agents-accept-"));
  const boot = readWindowsBoot(process.platform);
  const checks = runChecks({
    platform: process.platform,
    root,
    taskRegistered: boot.taskRegistered,
    processRunning: boot.processRunning,
    paperclipRunning: false,
    runnerRunning: false,
    tradingLoopRunning: false,
    workerThreads: 2,
    memoryCeilingMb: 1024,
  });
  for (const check of checks) console.log(`${check.status} ${check.name}: ${check.detail}`);
  if (checks.some((check) => check.status === "FAIL")) process.exitCode = 1;
  else if (checks.some((check) => check.status !== "PASS")) process.exitCode = 2;
}
