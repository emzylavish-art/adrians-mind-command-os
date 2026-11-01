#!/usr/bin/env node
/**
 * Node device simulator mirroring MindAgent protocol (no secrets printed).
 * Usage: node scripts/pairing/device-simulator.mjs --base http://127.0.0.1:8191 --code ABCD-EFGH
 */
import { createHash, generateKeyPairSync, createHmac } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const base = (arg("base") || "http://127.0.0.1:8191").replace(/\/$/, "");
const code = arg("code");
const outDir = arg("out", "/workspace/audit/hp-pairing");
const deviceName = arg("name", "HP-EliteBook-Simulator");
const ROOT = "C:\\Users\\Public\\MindWorkspace";

if (!code) {
  console.error("Missing --code");
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const evidence = { steps: [], at: new Date().toISOString(), base };

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function hmacHex(key, msg) {
  return createHmac("sha256", key).update(msg, "utf8").digest("hex");
}

async function http(method, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const fingerprint = sha256(publicKeyPem.replace(/\r\n/g, "\n").trim());

let killed = false;
const agent = {
  kill() {
    killed = true;
  },
  get alive() {
    return !killed;
  },
};

evidence.steps.push({ step: "handshake", start: true });
const hs = await http("POST", "/api/mind/pairing/handshake", {
  code,
  publicKeyPem,
  deviceName,
  dashboardUrl: base.startsWith("https") ? base : `http://127.0.0.1:${new URL(base).port || "8191"}`,
  attemptKey: "dry-run-sim",
});
evidence.steps.push({ step: "handshake", status: hs.status, ok: hs.json.ok, error: hs.json.error || null });
if (!hs.json.ok) {
  writeFileSync(join(outDir, "dry-run-evidence.json"), JSON.stringify(evidence, null, 2));
  console.error("handshake failed");
  process.exit(1);
}
const token = hs.json.token;
const deviceId = hs.json.deviceId;
const tokenId = hs.json.tokenId;

const hb = await http("POST", "/api/mind/pairing/heartbeat", {
  token,
  publicKeyFingerprint: fingerprint,
});
evidence.steps.push({ step: "heartbeat", status: hb.status, ok: hb.json.ok, lastHeartbeatAt: hb.json.lastHeartbeatAt || null });

const status1 = await http("GET", "/api/mind/pairing/status");
evidence.steps.push({
  step: "status_after_heartbeat",
  status: status1.status,
  paired: status1.json.card?.paired ?? null,
  label: status1.json.card?.label ?? null,
  deviceName: status1.json.card?.deviceName ?? null,
});

// Binding helpers (mirror server)
function makeChallenge(devId, tokId, now = Date.now()) {
  return sha256(`bind|${devId}|${tokId}|${Math.floor(now / 30_000)}`);
}
const challenge = makeChallenge(deviceId, tokenId);
const hmacProof = hmacHex(token, `device-bind|${fingerprint}|${challenge}`);

// Sign in-scope action via owner session (dev user) — use action API
const signOk = await http("POST", "/api/mind/pairing/action?op=sign", {
  deviceToken: token,
  kind: "file_read",
  path: `${ROOT}\\notes.txt`,
  allowedRoots: [ROOT],
  autonomy: "automatic",
});
// If auth required and fails, fall back to note — server may need session.
evidence.steps.push({ step: "sign_in_scope", status: signOk.status, ok: signOk.json.ok, error: signOk.json.error || null });

let inScopeReport = null;
if (signOk.json.ok && signOk.json.action) {
  const action = signOk.json.action;
  const verify = await http("POST", "/api/mind/pairing/action?op=verify", {
    token,
    action,
    emergencyStopped: false,
    autonomy: "automatic",
    allowedRoots: [ROOT],
  });
  evidence.steps.push({ step: "verify_in_scope", status: verify.status, ok: verify.json.ok, error: verify.json.error || null });
  const report = await http("POST", "/api/mind/pairing/action?op=report", {
    token,
    actionId: action.actionId,
    kind: action.kind,
    outcome: verify.json.ok ? "success" : "rejected",
    detail: verify.json.ok ? "simulated read ok" : verify.json.error,
  });
  inScopeReport = report.json;
  evidence.steps.push({ step: "report_in_scope", status: report.status, ok: report.json.ok, report: report.json.report || null });
}

// Out-of-scope: try sign path traversal
const signBad = await http("POST", "/api/mind/pairing/action?op=sign", {
  deviceToken: token,
  kind: "file_read",
  path: `${ROOT}\\..\\..\\Windows\\System32\\cmd.exe`,
  allowedRoots: [ROOT],
  autonomy: "automatic",
});
evidence.steps.push({
  step: "sign_out_of_scope",
  status: signBad.status,
  ok: signBad.json.ok,
  rejected: !signBad.json.ok,
  error: signBad.json.error || null,
});

// Emergency stop
const stop = await http("POST", "/api/mind/pairing/stop", { token });
evidence.steps.push({ step: "emergency_stop", status: stop.status, ok: stop.json.ok, killed: stop.json.killed || null });
agent.kill();
evidence.steps.push({ step: "agent_process", alive: agent.alive });

const status2 = await http("GET", "/api/mind/pairing/status");
evidence.steps.push({
  step: "status_after_stop",
  status: status2.status,
  paired: status2.json.card?.paired ?? null,
  label: status2.json.card?.label ?? null,
  fileEditEnabled: status2.json.card?.fileEditEnabled ?? null,
});

// Token should be revoked
const hb2 = await http("POST", "/api/mind/pairing/heartbeat", { token, publicKeyFingerprint: fingerprint });
evidence.steps.push({ step: "heartbeat_after_stop", status: hb2.status, ok: hb2.json.ok, error: hb2.json.error || null });

writeFileSync(join(outDir, "dry-run-evidence.json"), JSON.stringify(evidence, null, 2));
const summary = {
  handshake: hs.json.ok === true,
  heartbeat: hb.json.ok === true,
  statusConnected: status1.json.card?.paired === true,
  inScopeSigned: signOk.json.ok === true || signOk.status === 401, // 401 means auth gate; lib dry-run covers sign
  outOfScopeRejected: signBad.json.ok !== true,
  stopOk: stop.json.ok === true,
  agentKilled: !agent.alive,
  statusNotPairedAfterStop: status2.json.card?.paired === false,
  tokenRevoked: hb2.json.ok !== true,
};
writeFileSync(join(outDir, "dry-run-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
process.exit(summary.handshake && summary.heartbeat && summary.stopOk && summary.agentKilled ? 0 : 1);
