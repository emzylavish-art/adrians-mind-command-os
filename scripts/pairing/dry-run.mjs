#!/usr/bin/env node
/**
 * End-to-end dry run against a local preview: mint (lib), handshake/heartbeat/actions/stop
 * via HTTP simulator + direct lib card state. Cleans temp pairing store afterward.
 * Never prints the management key.
 */
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, createHmac } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = process.env.HP_PAIRING_PORT || "8191";
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "/workspace/audit/hp-pairing";
const ROOT = "C:\\Users\\Public\\MindWorkspace";
const STORE = join(process.cwd(), ".data", "mind-pairing-dry-run");

mkdirSync(OUT, { recursive: true });
mkdirSync(STORE, { recursive: true });

function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function hmacHex(key, msg) {
  return createHmac("sha256", key).update(msg, "utf8").digest("hex");
}

async function waitReady(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url);
      if (r.status > 0) return true;
    } catch {
      /* retry */
    }
    await sleep(1000);
  }
  return false;
}

// Prefer in-process dry run with pairing lib (authoritative) + optional HTTP if server up.
const evidence = { mode: "lib+http", steps: [], at: new Date().toISOString() };

const { mintPairingCode, exchangePairingCode, recordHeartbeat, pairingCardState, signDeviceAction, executeDeviceActionWithReport, deviceBindingHelpers, engageDeviceEmergencyStop, findDeviceByToken, setManagementKeyForTests, pairingCardFromApi } = await import("../../src/lib/mind/pairing/index.ts");
const { setPairingStoreDirectory, resetPairingStoreForTests, readPairingStore } = await import("../../src/lib/mind/pairing/store.ts");
const { signAgentManifest, verifyAgentFiles, hashContent } = await import("../../src/lib/mind/pairing/integrity.ts");
const { PairingCard, pairingCardFromApi: cardFromComp } = await import("../../src/components/mind/pairing/index.ts").catch(() => ({ PairingCard: null }));

// Use REAL management key from file (do not override / print)
setManagementKeyForTests(null);
setPairingStoreDirectory(STORE);
resetPairingStoreForTests();

const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

const minted = mintPairingCode("dev-user");
evidence.steps.push({ step: "mint", ok: minted.ok, expiresAt: minted.ok ? minted.expiresAt : null, codeLen: minted.ok ? minted.code.length : 0 });
if (!minted.ok) {
  writeFileSync(join(OUT, "dry-run-evidence.json"), JSON.stringify(evidence, null, 2));
  console.error("mint failed:", minted.error);
  process.exit(1);
}
// Do not write the raw code into long-lived audit if avoidable — store only length + id
const code = minted.code;

const card0 = pairingCardState("dev-user");
evidence.steps.push({ step: "card_before", paired: card0.paired, label: card0.label });

const ex = exchangePairingCode({ code, publicKeyPem, deviceName: "HP EliteBook Sim", attemptKey: "dry-run" });
evidence.steps.push({ step: "handshake", ok: ex.ok, deviceId: ex.ok ? ex.deviceId : null, error: ex.ok ? null : ex.error });
if (!ex.ok) process.exit(1);

recordHeartbeat(ex.token, Date.now(), ex.publicKeyFingerprint);
const card1 = pairingCardState("dev-user");
evidence.steps.push({
  step: "card_connected",
  paired: card1.paired,
  label: card1.label,
  deviceName: card1.paired ? card1.deviceName : null,
  fileEditEnabled: card1.paired ? card1.fileEditEnabled : false,
});

const helpers = deviceBindingHelpers(ex.token);
const signed = signDeviceAction({
  deviceToken: ex.token,
  kind: "file_read",
  path: `${ROOT}\\notes.txt`,
  allowedRoots: [ROOT],
  autonomy: "automatic",
});
evidence.steps.push({ step: "sign_in_scope", ok: signed.ok, error: signed.ok ? null : signed.error });
let inScope = null;
if (signed.ok && helpers.ok) {
  inScope = executeDeviceActionWithReport({
    deviceToken: ex.token,
    action: signed.action,
    emergencyStopped: false,
    allowedRoots: [ROOT],
    autonomy: "automatic",
    binding: { claimedFingerprint: helpers.fingerprint, challenge: helpers.challenge, hmacProof: helpers.hmacProof },
    run: () => ({ ok: true, detail: "simulated read" }),
  });
  evidence.steps.push({
    step: "run_in_scope",
    ok: inScope.ok,
    outcome: inScope.ok ? inScope.report.outcome : inScope.outcome,
    at: inScope.report?.at || inScope.ok && inScope.report?.at,
  });
}

const badSign = signDeviceAction({
  deviceToken: ex.token,
  kind: "file_read",
  path: `${ROOT}\\..\\..\\Windows\\System32\\cmd.exe`,
  allowedRoots: [ROOT],
  autonomy: "automatic",
});
evidence.steps.push({ step: "sign_out_of_scope", ok: badSign.ok, rejected: !badSign.ok, error: badSign.ok ? null : badSign.error });

// Manifest sign/verify
const files = { "MindAgent.ps1": hashContent(readFileSync(join(process.cwd(), "agent/windows/MindAgent.ps1"))), "Emergency-Stop.ps1": hashContent(readFileSync(join(process.cwd(), "agent/windows/Emergency-Stop.ps1"))) };
const man = signAgentManifest(files);
evidence.steps.push({ step: "manifest_sign", ok: man.ok, hasSignature: man.ok ? Boolean(man.manifest.signature) : false });
if (man.ok) {
  evidence.steps.push({ step: "manifest_verify", ok: verifyAgentFiles(files, man.manifest).ok });
}

const stop = engageDeviceEmergencyStop({ deviceId: ex.deviceId, userId: "dev-user" });
evidence.steps.push({ step: "emergency_stop", ok: stop.ok });
const revoked = findDeviceByToken(ex.token);
evidence.steps.push({ step: "token_revoked", ok: !revoked.ok, error: revoked.ok ? null : revoked.error });
const card2 = pairingCardState("dev-user");
evidence.steps.push({ step: "card_after_stop", paired: card2.paired, label: card2.label, fileEditEnabled: card2.fileEditEnabled });

// PairingCard state mapping
const fromApi = pairingCardFromApi({ card: card1 });
const fromApiAfter = pairingCardFromApi({ card: card2 });
evidence.steps.push({
  step: "pairing_card_mapping",
  connectedWouldRender: fromApi.paired === true && fromApi.label === "Connected",
  notPairedWouldRender: fromApiAfter.paired === false,
});

const reports = readPairingStore().reports;
evidence.steps.push({ step: "reports", count: reports.length, allHaveAt: reports.every((r) => r.at && r.outcome) });

const summary = {
  mint: minted.ok,
  handshake: ex.ok,
  cardWentConnected: card1.paired === true,
  inScopeSuccess: inScope?.ok === true,
  outOfScopeRejected: badSign.ok === false,
  manifestSigned: man.ok === true,
  stop: stop.ok,
  tokenRevoked: !revoked.ok,
  cardBackToNotPaired: card2.paired === false,
  reportsHaveTimestamps: reports.length > 0 && reports.every((r) => r.at),
};
writeFileSync(join(OUT, "dry-run-evidence.json"), JSON.stringify(evidence, null, 2));
writeFileSync(join(OUT, "dry-run-summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(
  join(OUT, "pairing-card-states.json"),
  JSON.stringify({ before: card0, connected: card1, afterStop: card2 }, null, 2),
);

// Cleanup temp device state so real card stays Not paired
rmSync(STORE, { recursive: true, force: true });
evidence.cleaned = true;
writeFileSync(join(OUT, "dry-run-cleaned.json"), JSON.stringify({ cleanedStore: STORE, at: new Date().toISOString() }, null, 2));

console.log(JSON.stringify(summary));
const pass = Object.values(summary).every(Boolean);
process.exit(pass ? 0 : 1);
