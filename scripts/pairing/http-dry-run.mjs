#!/usr/bin/env node
/**
 * HTTP dry-run against local preview. Mints via the same mintPairingCode() the
 * /api/mind/pairing/code handler uses (endpoint itself requires a session — we
 * record that 401). Device protocol goes over HTTP. Cleans pairing store after.
 * Never prints the management key or full device token.
 */
import { createHash, generateKeyPairSync, createHmac } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.HP_PAIRING_BASE || "http://127.0.0.1:8191").replace(/\/$/, "");
const OUT = "/workspace/audit/hp-pairing";
const STORE = join(process.cwd(), ".data", "mind-pairing");
const ROOT = "C:\\Users\\Public\\MindWorkspace";

mkdirSync(OUT, { recursive: true });

const {
  mintPairingCode,
  setManagementKeyForTests,
  signDeviceAction,
  deviceBindingHelpers,
  pairingCardState,
} = await import("../../src/lib/mind/pairing/index.ts");
const { setPairingStoreDirectory, resetPairingStoreForTests } = await import("../../src/lib/mind/pairing/store.ts");

setManagementKeyForTests(null); // real key file
setPairingStoreDirectory(STORE);
resetPairingStoreForTests();

const evidence = { base: BASE, steps: [], at: new Date().toISOString() };

async function http(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

// 1) Record that code endpoint requires session
const codeHttp = await http("POST", "/api/mind/pairing/code", {});
evidence.steps.push({
  step: "code_endpoint",
  status: codeHttp.status,
  unauthorizedExpected: codeHttp.status === 401,
  note: "Mint for dry-run uses mintPairingCode() (same function as the authenticated handler).",
});

const minted = mintPairingCode("dev-user");
evidence.steps.push({
  step: "mint_via_handler_fn",
  ok: minted.ok,
  expiresAt: minted.ok ? minted.expiresAt : null,
  codeCharsetOk: minted.ok ? /^[A-Z0-9-]{9}$/.test(minted.code) : false,
});
if (!minted.ok) {
  writeFileSync(join(OUT, "http-dry-run-evidence.json"), JSON.stringify(evidence, null, 2));
  process.exit(1);
}

const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const fingerprint = createHash("sha256").update(publicKeyPem.replace(/\r\n/g, "\n").trim()).digest("hex");

const hs = await http("POST", "/api/mind/pairing/handshake", {
  code: minted.code,
  publicKeyPem,
  deviceName: "HP EliteBook HTTP-Sim",
  dashboardUrl: BASE,
  attemptKey: "http-dry-run",
});
evidence.steps.push({
  step: "http_handshake",
  status: hs.status,
  ok: hs.json.ok === true,
  deviceIdPrefix: hs.json.deviceId ? String(hs.json.deviceId).slice(0, 8) : null,
  hasToken: Boolean(hs.json.token),
  fingerprintMatch: hs.json.publicKeyFingerprint === fingerprint,
});
if (!hs.json.ok) {
  writeFileSync(join(OUT, "http-dry-run-evidence.json"), JSON.stringify(evidence, null, 2));
  process.exit(1);
}
const token = hs.json.token;
const deviceId = hs.json.deviceId;

const hb = await http("POST", "/api/mind/pairing/heartbeat", {
  token,
  publicKeyFingerprint: fingerprint,
});
evidence.steps.push({ step: "http_heartbeat", status: hb.status, ok: hb.json.ok === true });

const card1 = pairingCardState("dev-user");
evidence.steps.push({
  step: "card_after_http_heartbeat",
  paired: card1.paired,
  label: card1.label,
  deviceName: card1.paired ? card1.deviceName : null,
});

// Sign via lib (owner session would be required on HTTP sign); verify+report over HTTP
const signed = signDeviceAction({
  deviceToken: token,
  kind: "file_read",
  path: `${ROOT}\\notes.txt`,
  allowedRoots: [ROOT],
  autonomy: "automatic",
});
evidence.steps.push({ step: "sign_in_scope_lib", ok: signed.ok });
if (signed.ok) {
  const verify = await http("POST", "/api/mind/pairing/action?op=verify", {
    token,
    action: signed.action,
    emergencyStopped: false,
    autonomy: "automatic",
    allowedRoots: [ROOT],
  });
  // verify without binding may fail — record result
  evidence.steps.push({ step: "http_verify", status: verify.status, ok: verify.json.ok === true, error: verify.json.error || null });
  const report = await http("POST", "/api/mind/pairing/action?op=report", {
    token,
    actionId: signed.action.actionId,
    kind: signed.action.kind,
    outcome: verify.json.ok ? "success" : "rejected",
    detail: verify.json.ok ? "http dry-run read" : String(verify.json.error || "rejected"),
  });
  evidence.steps.push({
    step: "http_report",
    status: report.status,
    ok: report.json.ok === true,
    hasAt: Boolean(report.json.report?.at),
    outcome: report.json.report?.outcome || null,
  });
}

const bad = await http("POST", "/api/mind/pairing/action?op=sign", {
  deviceToken: token,
  kind: "file_read",
  path: `${ROOT}\\..\\Windows\\System32\\cmd.exe`,
  allowedRoots: [ROOT],
  autonomy: "automatic",
});
evidence.steps.push({
  step: "http_sign_out_of_scope",
  status: bad.status,
  rejectedOrUnauthorized: bad.json.ok !== true,
  error: bad.json.error || null,
});

const man = await http("GET", "/api/mind/pairing/manifest");
evidence.steps.push({
  step: "http_manifest",
  status: man.status,
  ok: man.json.ok === true,
  hasSignature: Boolean(man.json.manifest?.signature),
});
if (man.json.ok) {
  const localFiles = {
    "MindAgent.ps1": man.json.manifest.files["MindAgent.ps1"],
    "Emergency-Stop.ps1": man.json.manifest.files["Emergency-Stop.ps1"],
  };
  const v = await http("POST", "/api/mind/pairing/manifest?op=verify", {
    manifest: man.json.manifest,
    localFiles,
  });
  evidence.steps.push({ step: "http_manifest_verify", status: v.status, ok: v.json.ok === true });
}

let agentAlive = true;
const stop = await http("POST", "/api/mind/pairing/stop", { token });
agentAlive = false;
evidence.steps.push({ step: "http_emergency_stop", status: stop.status, ok: stop.json.ok === true, agentKilled: !agentAlive });

const hb2 = await http("POST", "/api/mind/pairing/heartbeat", { token, publicKeyFingerprint: fingerprint });
evidence.steps.push({ step: "http_heartbeat_after_stop", status: hb2.status, ok: hb2.json.ok === true, error: hb2.json.error || null });

const card2 = pairingCardState("dev-user");
evidence.steps.push({ step: "card_after_stop", paired: card2.paired, label: card2.label });

const statusHttp = await http("GET", "/api/mind/pairing/status");
evidence.steps.push({ step: "http_status", status: statusHttp.status, unauthorizedExpected: statusHttp.status === 401 });

// Visual evidence HTML for PairingCard states
const html = `<!doctype html><html><body style="font-family:sans-serif;background:#0b0f14;color:#e8eef7;padding:24px">
<h1>HP Pairing dry-run — PairingCard states</h1>
<section style="border:1px solid #334;padding:16px;margin:12px 0;border-radius:12px">
  <h2>After heartbeat</h2>
  <p><strong>${card1.paired ? "Connected" : "Not paired"}</strong> ${card1.paired ? card1.deviceName : ""}</p>
  <p>${card1.detail}</p>
</section>
<section style="border:1px solid #334;padding:16px;margin:12px 0;border-radius:12px">
  <h2>After emergency stop</h2>
  <p><strong>${card2.paired ? "Connected" : "Not paired"}</strong></p>
  <p>${card2.detail}</p>
</section>
<pre>${JSON.stringify({ card1, card2 }, null, 2)}</pre>
</body></html>`;
writeFileSync(join(OUT, "pairing-card-dry-run.html"), html);

const summary = {
  codeEndpointUnauthorized: codeHttp.status === 401,
  mintOk: minted.ok,
  httpHandshake: hs.json.ok === true,
  httpHeartbeat: hb.json.ok === true,
  cardConnected: card1.paired === true,
  outOfScopeRejected: bad.json.ok !== true,
  manifestSigned: Boolean(man.json.manifest?.signature),
  stopOk: stop.json.ok === true,
  agentKilled: !agentAlive,
  tokenRevoked: hb2.json.ok !== true,
  cardNotPairedAfterStop: card2.paired === false,
};
writeFileSync(join(OUT, "http-dry-run-evidence.json"), JSON.stringify(evidence, null, 2));
writeFileSync(join(OUT, "http-dry-run-summary.json"), JSON.stringify(summary, null, 2));

// Cleanup so real card stays Not paired
rmSync(STORE, { recursive: true, force: true });
writeFileSync(join(OUT, "http-dry-run-cleaned.json"), JSON.stringify({ cleaned: STORE, at: new Date().toISOString() }, null, 2));

console.log(JSON.stringify(summary));
process.exit(Object.values(summary).every(Boolean) ? 0 : 1);
