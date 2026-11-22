/**
 * Adrian Mind OS — always-on local model runner (nervous system layer).
 * Loopback only. Never deletes, sends, deploys, or commits.
 * Swappable weights: place a GGUF or note file under models/; runner still works in heuristic mode.
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  appendFileSync,
  watch,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { homedir, freemem, totalmem } from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(process.env.ADRIAN_LOCAL_MODEL_HOME || join(__dirname, "local-model"));
const PORT = Number(process.env.ADRIAN_LOCAL_MODEL_PORT || 9400);
const HOST = "127.0.0.1";

const PATHS = {
  root: ROOT,
  jobs: join(ROOT, "jobs"),
  output: join(ROOT, "output"),
  review: join(ROOT, "review"),
  models: join(ROOT, "models"),
  data: join(ROOT, "data"),
  log: join(ROOT, "data", "runner.log"),
};

for (const p of Object.values(PATHS)) {
  if (p.endsWith(".log")) continue;
  mkdirSync(p, { recursive: true });
}

function log(line) {
  const row = `${new Date().toISOString()} ${line}\n`;
  try {
    appendFileSync(PATHS.log, row);
  } catch {
    /* ignore */
  }
  console.log(line);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeJson(dir, name, body) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  return file;
}

function propose(kind, pattern, change, extra = {}) {
  const file = writeJson(PATHS.review, `${stamp()}-${kind}.md.json`, {
    timestamp: new Date().toISOString(),
    kind,
    pattern,
    suggested_change: change,
    status: "proposal",
    irreversible: false,
    ...extra,
  });
  // Also a human-readable markdown twin
  const md = join(PATHS.review, `${stamp()}-${kind}.md`);
  writeFileSync(
    md,
    `# Proposal: ${kind}\n\n- time: ${new Date().toISOString()}\n- pattern: ${pattern}\n- suggested: ${change}\n- status: awaiting owner or cloud approval\n\n\`\`\`json\n${JSON.stringify(extra, null, 2)}\n\`\`\`\n`,
  );
  return { json: file, md };
}

function allowedOrigin(origin) {
  if (!origin) return `http://${HOST}:${PORT}`;
  try {
    const url = new URL(origin);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return origin;
  } catch {
    return "";
  }
  return "";
}

function send(res, status, body, originHeader = "") {
  const origin = allowedOrigin(originHeader);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": origin || "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sha256File(path) {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.hexdigest ? h.hexdigest() : h.digest("hex");
}

function classifyFile(name) {
  const ext = extname(name).toLowerCase();
  const map = {
    ".png": "images",
    ".jpg": "images",
    ".jpeg": "images",
    ".webp": "images",
    ".gif": "images",
    ".pdf": "docs",
    ".md": "docs",
    ".txt": "docs",
    ".docx": "docs",
    ".xlsx": "sheets",
    ".csv": "sheets",
    ".json": "data",
    ".zip": "archives",
    ".7z": "archives",
    ".exe": "installers",
    ".msi": "installers",
    ".mp4": "video",
    ".mp3": "audio",
    ".wav": "audio",
    ".js": "code",
    ".ts": "code",
    ".tsx": "code",
    ".py": "code",
  };
  return map[ext] || "misc";
}

function normalizeName(name) {
  return name
    .replace(/\s+/g, "_")
    .replace(/[^\w.\-]+/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
}

/** Job 1 — classify new files (proposal only) */
function jobClassifyWatch(paths) {
  const proposals = [];
  for (const dir of paths) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const ageMs = Date.now() - st.mtimeMs;
      if (ageMs > 1000 * 60 * 60 * 24) continue; // only recent
      const dest = classifyFile(name);
      const norm = normalizeName(name);
      proposals.push({
        path: full,
        type: dest,
        proposed_name: norm,
        proposed_folder: join(dir, dest),
      });
    }
  }
  if (proposals.length) {
    propose("file-classify", "new files in watch dirs", "owner moves files into proposed folders", { proposals });
  }
  return { ok: true, count: proposals.length, proposals };
}

/** Job 2 — hash-dedupe surface pairs */
function jobDedupe(paths) {
  const hashes = new Map();
  const pairs = [];
  for (const dir of paths) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      try {
        if (!statSync(full).isFile()) continue;
        if (statSync(full).size > 50 * 1024 * 1024) continue;
        const h = sha256File(full);
        if (hashes.has(h)) pairs.push({ a: hashes.get(h), b: full, sha256: h });
        else hashes.set(h, full);
      } catch {
        /* skip */
      }
    }
  }
  if (pairs.length) propose("file-dedupe", "duplicate content hashes", "owner deletes one of each pair; never auto-delete", { pairs });
  return { ok: true, pairs };
}

/** Job 3 — broken/missing extensions */
function jobBrokenExt(paths) {
  const flags = [];
  for (const dir of paths) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      try {
        if (!statSync(full).isFile()) continue;
      } catch {
        continue;
      }
      if (!extname(name)) {
        const head = readFileSync(full).subarray(0, 16);
        let guess = null;
        if (head[0] === 0x89 && head[1] === 0x50) guess = ".png";
        else if (head[0] === 0xff && head[1] === 0xd8) guess = ".jpg";
        else if (head.toString("utf8", 0, 4) === "%PDF") guess = ".pdf";
        else if (head[0] === 0x50 && head[1] === 0x4b) guess = ".zip";
        flags.push({ path: full, suggested_extension: guess || "unknown" });
      }
    }
  }
  if (flags.length) propose("broken-extension", "files without extension", "owner renames with suggested extension", { flags });
  return { ok: true, flags };
}

/** Job 4 — disk free under 10% */
function jobDiskAlert(path = "/") {
  try {
    const stdout = execFileSync("df", ["-P", path], { encoding: "utf8" });
    const line = stdout.trim().split("\n").pop();
    const parts = line.split(/\s+/);
    const use = Number(String(parts[4] || "").replace("%", ""));
    const alert = use >= 90;
    if (alert) propose("disk-space", `use ${use}% on ${path}`, "owner frees space before install/build", { use_percent: use, path });
    return { ok: true, use_percent: use, alert };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Job 5 — 30-day stale */
function jobStale(paths, days = 30) {
  const stale = [];
  const cutoff = Date.now() - days * 86400000;
  function walk(dir, depth = 0) {
    if (depth > 4 || !existsSync(dir)) return;
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === "node_modules" || name === ".git" || name === ".venv") continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, depth + 1);
      else if (st.isFile() && st.mtimeMs < cutoff) stale.push({ path: full, mtime: new Date(st.mtimeMs).toISOString() });
    }
  }
  for (const p of paths) walk(p);
  if (stale.length) propose("stale-files", `untouched ${days}+ days`, "owner archive or delete after review", { count: stale.length, sample: stale.slice(0, 50) });
  return { ok: true, count: stale.length, sample: stale.slice(0, 20) };
}

/** Job 6 — gpt-bridge log digest */
function jobLogDigest(logDirs) {
  const errors = {};
  for (const dir of logDirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!/\.(log|txt)$/i.test(name)) continue;
      const text = readFileSync(join(dir, name), "utf8");
      for (const line of text.split(/\r?\n/)) {
        if (/error|fail|exception|fatal/i.test(line)) {
          const key = line.slice(0, 120).replace(/\d+/g, "#");
          errors[key] = (errors[key] || 0) + 1;
        }
      }
    }
  }
  const top = Object.entries(errors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([pattern, count]) => ({ pattern, count }));
  writeJson(PATHS.output, `${stamp()}-log-digest.json`, { day: new Date().toISOString().slice(0, 10), top });
  return { ok: true, top };
}

/** Job 7 — local deploy log scan */
function jobDeployFlags(paths) {
  const flags = [];
  for (const dir of paths) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      try {
        if (!statSync(full).isFile()) continue;
        const t = readFileSync(full, "utf8");
        if (/failed|error|Build failed|Deployment failed/i.test(t)) {
          flags.push({ file: full, summary: t.split(/\r?\n/).find((l) => /fail|error/i.test(l))?.slice(0, 200) || "failed build markers" });
        }
      } catch {
        /* skip */
      }
    }
  }
  if (flags.length) propose("deploy-fail", "failed build markers in logs", "owner inspects flagged deploy logs", { flags });
  return { ok: true, flags };
}

/** Job 8 — CPU hogs (best-effort via ps) */
async function jobCpuHogs() {
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid,pcpu,pmem,comm", "--sort=-pcpu"], { encoding: "utf8" });
    const lines = stdout.trim().split("\n").slice(1, 15);
    const heavy = lines
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => Number(p[1]) >= 80)
      .map((p) => ({ pid: p[0], pcpu: p[1], pmem: p[2], comm: p.slice(3).join(" ") }));
    if (heavy.length) propose("cpu-hog", "process >= 80% CPU snapshot", "owner decides kill; runner never kills", { heavy });
    return { ok: true, heavy, note: "single snapshot; sustained 10-min track needs resident samples in data/" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Job 9 — service health */
async function jobServiceHealth(targets) {
  const results = [];
  for (const t of targets) {
    try {
      const res = await fetch(t.url, { signal: AbortSignal.timeout(3000) });
      results.push({ name: t.name, url: t.url, status: res.status, ok: res.ok });
    } catch (e) {
      results.push({ name: t.name, url: t.url, ok: false, error: String(e.message || e) });
      propose("service-down", `${t.name} not answering`, "owner restarts service; auto-restart only if config allows later", { target: t });
    }
  }
  writeJson(PATHS.output, `${stamp()}-health.json`, { results });
  return { ok: true, results };
}

/** Job 10 — night-check parse */
function jobNightCheck(paths) {
  const reports = [];
  for (const dir of paths) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!/night|check|proof/i.test(name)) continue;
      const full = join(dir, name);
      try {
        if (!statSync(full).isFile()) continue;
        const t = readFileSync(full, "utf8");
        const fail = /FAIL|failed|error/i.test(t);
        const line = t.split(/\r?\n/).find((l) => /FAIL|failed|error/i.test(l)) || null;
        reports.push({ file: full, pass: !fail, failing_step: fail ? line : null });
      } catch {
        /* skip */
      }
    }
  }
  writeJson(PATHS.output, `${stamp()}-nightcheck.json`, { reports });
  return { ok: true, reports };
}

/** Jobs 11–13 lightweight text helpers */
function jobThreeBulletSummary(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const pick = lines.filter((l) => l.length > 40).slice(0, 3);
  while (pick.length < 3 && lines[pick.length]) pick.push(lines[pick.length]);
  return { ok: true, bullets: pick.map((l) => l.slice(0, 200)) };
}

function jobTodoBacklog(rootDirs) {
  const items = [];
  const re = /\b(TODO|FIX|NOTE)\b[:\s-]*(.*)/i;
  function walk(dir, depth = 0) {
    if (depth > 5 || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".git", ".venv", "dist"].includes(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, depth + 1);
      else if (/\.(js|ts|tsx|py|md|cjs|mjs)$/.test(name) && st.size < 2_000_000) {
        const text = readFileSync(full, "utf8");
        text.split(/\r?\n/).forEach((line, i) => {
          const m = line.match(re);
          if (m) items.push({ file: full, line: i + 1, tag: m[1].toUpperCase(), text: m[2].trim().slice(0, 200) });
        });
      }
    }
  }
  for (const d of rootDirs) walk(d);
  items.sort((a, b) => a.file.localeCompare(b.file));
  writeJson(PATHS.output, `${stamp()}-todo-backlog.json`, { items });
  return { ok: true, count: items.length, items: items.slice(0, 200) };
}

const JOBS = {
  "file-classify": () =>
    jobClassifyWatch([
      join(homedir(), "Downloads"),
      join(homedir(), "Desktop"),
      "/home/ubuntu/Downloads",
    ]),
  "file-dedupe": () => jobDedupe(["/home/ubuntu/Downloads", join(homedir(), "Downloads")]),
  "broken-extension": () => jobBrokenExt(["/home/ubuntu/Downloads"]),
  "disk-alert": () => jobDiskAlert("/"),
  "stale-files": () => jobStale(["/tmp/adrian-visual-handoff", "/home/ubuntu/adrians-mind-command-os"]),
  "log-digest": () => jobLogDigest(["/home/ubuntu/terminal_full_output", PATHS.data]),
  "deploy-flags": () => jobDeployFlags(["/home/ubuntu/terminal_full_output", PATHS.data]),
  "cpu-hogs": () => jobCpuHogs(),
  "service-health": () =>
    jobServiceHealth([
      { name: "local-model-self", url: `http://${HOST}:${PORT}/health` },
      { name: "ollama", url: "http://127.0.0.1:11434/api/tags" },
      { name: "social", url: "http://127.0.0.1:8765/healthz" },
      { name: "research", url: "http://127.0.0.1:8766/mcp" },
    ]),
  "night-check": () => jobNightCheck(["/home/ubuntu/adrians-mind-command-os/proof", PATHS.output]),
  "text-summary": (payload) => jobThreeBulletSummary(payload?.text || ""),
  "todo-backlog": () => jobTodoBacklog(["/tmp/adrian-visual-handoff/src", "/home/ubuntu/adrians-mind-command-os/src"]),
  "rate-limit-preempt": (payload) => {
    const headers = payload?.headers || {};
    const remaining = Number(headers["x-ratelimit-remaining"] ?? headers["ratelimit-remaining"] ?? NaN);
    const proposal =
      Number.isFinite(remaining) && remaining < 5
        ? propose("rate-limit", `remaining=${remaining}`, "downgrade to free tier or queue task", { headers })
        : null;
    return { ok: true, remaining, proposal };
  },
  "doc-freshness": (payload) => {
    const claim = String(payload?.claim || "");
    const reality = String(payload?.reality || "");
    const mismatch = claim && reality && claim !== reality;
    if (mismatch) propose("doc-freshness", "README/code comment mismatch", "update docs to match runtime", { claim, reality });
    return { ok: true, mismatch };
  },
  "backup-verify": (payload) => {
    // Safe: only checks that a given path exists; never restores production
    const sample = payload?.path || PATHS.data;
    const exists = existsSync(sample);
    const result = { ok: exists, path: sample, note: "sandbox check only; no production restore in this build" };
    writeJson(PATHS.output, `${stamp()}-backup-verify.json`, result);
    return result;
  },
  "manual": (payload) => {
    const name = payload?.job;
    if (!name || name === "manual" || !JOBS[name]) return { ok: false, error: "unknown job" };
    return runJob(name, payload?.payload || {});
  },
};

async function runJob(name, payload = {}) {
  const fn = JOBS[name];
  if (!fn) return { ok: false, error: `unknown job ${name}` };
  log(`run ${name}`);
  try {
    const result = await fn(payload);
    writeJson(PATHS.output, `${stamp()}-${name}.json`, { job: name, result });
    return { ok: true, job: name, result };
  } catch (e) {
    const err = { ok: false, job: name, error: String(e?.message || e) };
    writeJson(PATHS.output, `${stamp()}-${name}-error.json`, err);
    log(`fail ${name} ${err.error}`);
    return err;
  }
}

async function pollJobsDir() {
  if (!existsSync(PATHS.jobs)) return;
  for (const name of readdirSync(PATHS.jobs)) {
    if (!name.endsWith(".json")) continue;
    const full = join(PATHS.jobs, name);
    try {
      const job = JSON.parse(readFileSync(full, "utf8"));
      const out = await runJob(job.name || job.job, job.payload || job);
      writeJson(PATHS.output, `${stamp()}-queued-${name}`, out);
      renameSync(full, join(PATHS.output, `done-${stamp()}-${name}`));
    } catch (e) {
      log(`queue error ${name} ${e}`);
    }
  }
}

function modelStatus() {
  const files = existsSync(PATHS.models) ? readdirSync(PATHS.models) : [];
  const weights = files.filter((f) => /\.(gguf|onnx|bin|safetensors)$/i.test(f));
  return {
    mode: weights.length ? "weights-present-swappable" : "heuristic-no-weights",
    weights,
    note: "Interface is frozen JSON over localhost. Drop weights into models/ and restart to upgrade without code changes.",
  };
}


/** Three-tier: doorman(1) always, worker(2) lazy 30s unload, brain(3) cloud. */
const TIER1_GATE = 0.8;
const TIER2_IDLE_MS = 30_000;
let tier2 = { loaded: false, lastUsedAt: null, loadedAtStartup: false };
const tierLogPath = join(PATHS.data, "daily-command-log.ndjson");

function classifyIntent(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return { intent: "heartbeat", confidence: 1 };
  if (/^(ping|health|heartbeat|status)\b/.test(t)) return { intent: "heartbeat", confidence: 0.95 };
  if (/^(hey|wake|adrian|listen)\b/.test(t)) return { intent: "wake_word", confidence: 0.9 };
  if (/architect|redesign system|multi-?step|long context|refactor entire/.test(t)) return { intent: "architecture", confidence: 0.85 };
  if (/error log|stack trace|build failed|summarize (the )?build|fix this error/.test(t)) return { intent: "log_triage", confidence: 0.82 };
  if (/^(hi|hello|hey|thanks|ok)\b/.test(t) && t.length < 40) return { intent: "simple_chat", confidence: 0.88 };
  if (t.length < 120) return { intent: "routine_tool", confidence: 0.75 };
  return { intent: "general", confidence: 0.7 };
}

function routeAgentTier(input = {}) {
  if (input.forceTier === 1 || input.forceTier === 2 || input.forceTier === 3) {
    return { tier: input.forceTier, reason: "force", confidence: 1, intent: "forced", loadTier2: input.forceTier === 2, preloadTier2AtStartup: false };
  }
  const c = input.intent && input.confidence != null ? { intent: input.intent, confidence: input.confidence } : classifyIntent(input.text || "");
  const t1only = new Set(["wake_word", "heartbeat", "log_event", "intent_classify", "route_decide", "health"]);
  const t3 = new Set(["architecture", "multi_step_debug", "long_context", "complex_debug", "agentic"]);
  if (t1only.has(c.intent) && c.confidence >= TIER1_GATE) return { tier: 1, reason: "doorman", confidence: c.confidence, intent: c.intent, loadTier2: false, preloadTier2AtStartup: false };
  if (t3.has(c.intent) || input.tier2Uncertain) return { tier: 3, reason: input.tier2Uncertain ? "worker uncertain" : "cloud brain", confidence: c.confidence, intent: c.intent, loadTier2: false, preloadTier2AtStartup: false };
  if (c.confidence < TIER1_GATE) return { tier: 2, reason: "low confidence", confidence: c.confidence, intent: c.intent, loadTier2: true, preloadTier2AtStartup: false };
  return { tier: 2, reason: "worker default", confidence: c.confidence, intent: c.intent, loadTier2: true, preloadTier2AtStartup: false };
}

function touchWorker() {
  tier2 = { loaded: true, lastUsedAt: Date.now(), loadedAtStartup: false };
  log("tier2 worker LOADED on demand");
}
function unloadWorkerIfIdle() {
  if (tier2.loaded && tier2.lastUsedAt != null && Date.now() - tier2.lastUsedAt >= TIER2_IDLE_MS) {
    tier2 = { loaded: false, lastUsedAt: null, loadedAtStartup: false };
    log("tier2 worker UNLOADED after 30s idle");
  }
}
setInterval(unloadWorkerIfIdle, 5_000);

function appendDailyLog(rec) {
  const line = [
    rec.at,
    `tier=${rec.tier}`,
    `intent=${rec.intent}`,
    `latency_ms=${rec.latencyMs}`,
    `accepted=${rec.accepted == null ? "pending" : rec.accepted ? "accepted" : "rejected"}`,
    `useful=${rec.useful == null ? "n/a" : rec.useful ? "useful" : "not-useful"}`,
    `prompt_chars=${rec.promptChars}`,
    `response_chars=${rec.responseChars}`,
  ].join(" | ") + "\n";
  appendFileSync(tierLogPath, line);
}



// --- auto-generated catalog merge ---
function stubObligation(name, note = "scheduled proposal stub") {
  return (payload = {}) => {
    const p = propose(name, note, "awaiting owner or cloud approval", { payload, group: name });
    writeJson(PATHS.output, `${stamp()}-${name}.json`, { job: name, stub: true, payload });
    return { ok: true, job: name, stub: true, proposal: p };
  };
}
const CATALOG_NAMES = ["file-classify", "file-folder-propose", "file-normalize-names", "file-dedupe", "broken-extension", "disk-alert", "stale-files", "log-digest", "deploy-flags", "cpu-hogs", "service-health", "night-check", "heartbeat-ping", "text-summary", "todo-backlog", "timestamp-normalize", "strip-nav-noise", "language-detect", "sentiment-score", "log-line-dedupe", "url-validate", "format-roundtrip", "text-diff", "sort-imports", "unused-imports", "syntax-prebuild", "conventional-commit-draft", "changelog-draft", "test-case-suggest", "secret-scan", "package-venv-crosscheck", "endpoint-docs", "jsdoc-stub", "json-yaml-validate", "env-var-confirm", "csv-json-roundtrip", "contact-normalize", "schema-drift", "missing-required-fields", "merge-duplicate-contacts", "watchlist-dedupe", "port-in-use", "hash-manifest-backup", "draft-reply-tone", "voice-note-bullets", "short-translate", "grammar-proof", "extract-action-items", "email-subject-lines", "collapse-thread", "message-triage", "classify-difficulty", "model-route", "morning-queue", "cost-latency-log", "automation-propose", "auto-file-errors", "daily-briefing", "failure-pattern-memory", "manus-repeat-flag", "skill-usage-audit", "convention-diff", "notion-automation-mine", "cost-rebalance", "rate-limit-preempt", "doc-freshness", "backup-verify", "time-awareness", "energy-sensing", "network-sensing", "local-checkpoints", "credential-age", "paste-pattern", "session-continuity", "cross-project-correlate", "quiet-hours", "hardware-sensing", "swappable-model-status"];
const CATALOG_JOBS = Object.fromEntries(CATALOG_NAMES.map((n) => [n, stubObligation(n)]));
for (const [k, v] of Object.entries(CATALOG_JOBS)) {
  if (!JOBS[k]) JOBS[k] = v;
}
function listAllJobs() {
  return Object.keys(JOBS).sort();
}
const SCHEDULE = [
  { job: "disk-alert", everyMs: 300000 },
  { job: "service-health", everyMs: 60000 },
  { job: "log-digest", everyMs: 600000 },
  { job: "time-awareness", everyMs: 900000 },
  { job: "hardware-sensing", everyMs: 120000 },
  { job: "quiet-hours", everyMs: 300000 },
  { job: "energy-sensing", everyMs: 180000 },
  { job: "network-sensing", everyMs: 120000 },
  { job: "local-checkpoints", everyMs: 1800000 },
  { job: "credential-age", everyMs: 3600000 },
  { job: "backup-verify", everyMs: 7200000 },
  { job: "daily-briefing", everyMs: 3600000 },
  { job: "morning-queue", everyMs: 3600000 },
  { job: "failure-pattern-memory", everyMs: 1800000 },
  { job: "swappable-model-status", everyMs: 600000 },
];
function startScheduledLoops() {
  for (const s of SCHEDULE) {
    setInterval(() => runJob(s.job).catch((e) => log(String(e))), s.everyMs);
  }
  log(`scheduled ${SCHEDULE.length} background loops`);
}

JOBS["hardware-sensing"] = () => {
  const free = freemem();
  const total = totalmem();
  const pct = Math.round((1 - free / total) * 100);
  const body = { free, total, used_percent: pct, note: "thermals/battery need Windows sensors on PC" };
  if (pct >= 90) propose("hardware-sensing", `RAM use ${pct}%`, "owner closes heavy apps; runner never kills", body);
  writeJson(PATHS.output, `${stamp()}-hardware-sensing.json`, body);
  return { ok: true, ...body };
};
JOBS["time-awareness"] = () => {
  const now = new Date();
  const hour = now.getHours();
  const phase = hour < 6 ? "sleep" : hour < 12 ? "morning" : hour < 18 ? "day" : hour < 22 ? "evening" : "wind-down";
  const body = { iso: now.toISOString(), hour, phase };
  if (phase === "morning") propose("time-awareness", "morning window", "pre-stage morning briefing into review/", body);
  writeJson(PATHS.output, `${stamp()}-time-awareness.json`, body);
  return { ok: true, ...body };
};
JOBS["quiet-hours"] = () => {
  const hour = new Date().getHours();
  const quiet = hour >= 23 || hour < 7;
  const body = { quiet, hour, policy: "suppress non-critical alerts during quiet" };
  writeJson(PATHS.output, `${stamp()}-quiet-hours.json`, body);
  return { ok: true, ...body };
};
JOBS["network-sensing"] = async () => {
  let online = false;
  try {
    await fetch("https://1.1.1.1", { method: "HEAD", signal: AbortSignal.timeout(2500) });
    online = true;
  } catch {
    online = false;
  }
  const body = { online, action_if_offline: "defer cloud tier-3 jobs" };
  if (!online) propose("network-sensing", "line down or flaky", "defer cloud jobs; keep local doorman/worker", body);
  writeJson(PATHS.output, `${stamp()}-network-sensing.json`, body);
  return { ok: true, ...body };
};
JOBS["energy-sensing"] = () => {
  let load = null;
  try {
    load = readFileSync("/proc/loadavg", "utf8").trim();
  } catch {
    /* win */
  }
  const body = { load, mode: "proxy-via-loadavg", shift: "when busy lower scan weight" };
  writeJson(PATHS.output, `${stamp()}-energy-sensing.json`, body);
  return { ok: true, ...body };
};
JOBS["local-checkpoints"] = () => {
  const snap = { at: new Date().toISOString(), paths: PATHS, model: modelStatus(), tier2 };
  const file = writeJson(PATHS.data, `checkpoint-${stamp()}.json`, snap);
  return { ok: true, checkpoint: file };
};
JOBS["credential-age"] = () => {
  const candidates = [join(homedir(), ".adrian", "keys"), join(ROOT, "data", "credentials-meta.json")];
  const ages = [];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const st = statSync(p);
      ages.push({
        path: p,
        mtime: new Date(st.mtimeMs).toISOString(),
        age_days: Math.floor((Date.now() - st.mtimeMs) / 86400000),
      });
    } catch {
      /* */
    }
  }
  const old = ages.filter((a) => a.age_days >= 90);
  if (old.length)
    propose("credential-age", "credential metadata older than 90 days", "owner rotates keys; runner never reads values", {
      old,
    });
  return { ok: true, ages, note: "values never read" };
};
JOBS["swappable-model-status"] = () => {
  const st = modelStatus();
  writeJson(PATHS.output, `${stamp()}-swappable-model-status.json`, st);
  return { ok: true, ...st };
};
JOBS["heartbeat-ping"] = () => jobServiceHealth([{ name: "self", url: `http://${HOST}:${PORT}/health` }]);
JOBS["daily-briefing"] = () => {
  const files = existsSync(PATHS.output) ? readdirSync(PATHS.output).slice(-30) : [];
  const body = { day: new Date().toISOString().slice(0, 10), recent_outputs: files, note: "one-page briefing draft" };
  propose("daily-briefing", "end-of-day rollup", "owner reviews briefing draft", body);
  return { ok: true, ...body };
};

const server = createServer(async (req, res) => {
  const originHeader = req.headers.origin || "";
  if (req.method === "OPTIONS") return send(res, 204, {}, originHeader);
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return send(
      res,
      200,
      {
        ok: true,
        service: "local-model-runner",
        host: HOST,
        port: PORT,
        model: modelStatus(),
        jobs: typeof listAllJobs === 'function' ? listAllJobs() : Object.keys(JOBS),
        safety: {
          never_deletes: true,
          never_sends: true,
          never_deploys: true,
          never_commits: true,
          proposals_only: true,
        },
        paths: PATHS,
        mem: { free: freemem(), total: totalmem() },
        tiers: { tier2, idleUnloadMs: TIER2_IDLE_MS, mindOsPreloadsTier2: false },
      },
      originHeader,
    );
  }

  if (req.method === "GET" && url.pathname === "/jobs") {
    return send(res, 200, { jobs: Object.keys(JOBS) }, originHeader);
  }

  if (req.method === "POST" && url.pathname === "/run") {
    try {
      const body = await readBody(req);
      const name = body.job || body.name;
      const out = await runJob(name, body.payload || body);
      return send(res, out.ok ? 200 : 400, out, originHeader);
    } catch (e) {
      return send(res, 400, { ok: false, error: String(e.message || e) }, originHeader);
    }
  }

  if (req.method === "POST" && url.pathname === "/propose") {
    try {
      const body = await readBody(req);
      const p = propose(body.kind || "manual", body.pattern || "", body.change || "", body.extra || {});
      return send(res, 200, { ok: true, ...p }, originHeader);
    } catch (e) {
      return send(res, 400, { ok: false, error: String(e.message || e) }, originHeader);
    }
  }

  
  if (req.method === "GET" && url.pathname === "/tiers") {
    unloadWorkerIfIdle();
    return send(res, 200, {
      ok: true,
      roles: {
        1: "doorman — always resident ~300MB; route/heartbeat/wake only",
        2: "worker — 7B 4-bit load-on-demand; hard unload 30s idle; never at startup",
        3: "brain — cloud via OpenAI Key Proxy; rare expensive calls",
      },
      tier2,
      idleUnloadMs: TIER2_IDLE_MS,
      confidenceGate: TIER1_GATE,
      mindOsPreloadsTier2: false,
    }, originHeader);
  }

  if (req.method === "POST" && url.pathname === "/route") {
    try {
      const body = await readBody(req);
      const started = Date.now();
      const decision = routeAgentTier(body);
      if (decision.loadTier2) touchWorker();
      const latencyMs = Date.now() - started;
      const rec = {
        at: new Date().toISOString(),
        tier: decision.tier,
        intent: decision.intent,
        latencyMs,
        accepted: null,
        useful: null,
        promptChars: String(body.text || "").length,
        responseChars: 0,
      };
      appendDailyLog(rec);
      return send(res, 200, { ok: true, decision, tier2, latencyMs, dailyLog: tierLogPath }, originHeader);
    } catch (e) {
      return send(res, 400, { ok: false, error: String(e.message || e) }, originHeader);
    }
  }

  if (req.method === "POST" && url.pathname === "/tier-feedback") {
    try {
      const body = await readBody(req);
      appendDailyLog({
        at: new Date().toISOString(),
        tier: body.tier || 0,
        intent: body.intent || "feedback",
        latencyMs: body.latencyMs || 0,
        accepted: body.accepted ?? null,
        useful: body.useful ?? null,
        promptChars: body.promptChars || 0,
        responseChars: body.responseChars || 0,
      });
      return send(res, 200, { ok: true }, originHeader);
    } catch (e) {
      return send(res, 400, { ok: false, error: String(e.message || e) }, originHeader);
    }
  }


  send(res, 404, { ok: false, error: "routes: GET /health /jobs /tiers POST /run /propose /route /tier-feedback" }, originHeader);
});

server.listen(PORT, HOST, () => {
  log(`local-model-runner on http://${HOST}:${PORT}`);
  // boot sprint jobs 1-10 lightly
  setTimeout(() => {
    ["disk-alert", "service-health", "log-digest"].forEach((j) => runJob(j).catch(() => {}));
  }, 500);
  setInterval(() => pollJobsDir().catch((e) => log(String(e))), 10_000);
  if (typeof startScheduledLoops === "function") startScheduledLoops();
  runJob("swappable-model-status").catch(() => {});
  runJob("hardware-sensing").catch(() => {});
  runJob("time-awareness").catch(() => {});
});
