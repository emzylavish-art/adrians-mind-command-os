import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setManagementKeyForTests } from "./management-key.ts";
import { setPairingStoreDirectory, resetPairingStoreForTests, readPairingStore } from "./store.ts";
import { mintPairingCode, exchangePairingCode } from "./handshake.ts";
import { signDeviceAction, executeDeviceActionWithReport, deviceBindingHelpers } from "./actions.ts";

const ROOT = "C:\\Users\\Public\\MindWorkspace";

describe("action outcome reports", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pair-rpt-"));
    setPairingStoreDirectory(dir);
    resetPairingStoreForTests();
    setManagementKeyForTests("test-management-key-not-real");
  });
  afterEach(() => {
    setManagementKeyForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  function pair() {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
    const minted = mintPairingCode("owner");
    assert.equal(minted.ok, true);
    if (!minted.ok) throw new Error("mint");
    const ex = exchangePairingCode({ code: minted.code, publicKeyPem: pub, deviceName: "HP" });
    assert.equal(ex.ok, true);
    if (!ex.ok) throw new Error("ex");
    return ex;
  }

  it("records timestamped success and rejected outcomes for every action path", () => {
    const ex = pair();
    const helpers = deviceBindingHelpers(ex.token);
    assert.equal(helpers.ok, true);
    if (!helpers.ok) return;
    const signed = signDeviceAction({
      deviceToken: ex.token,
      kind: "file_read",
      path: `${ROOT}\\a.txt`,
      allowedRoots: [ROOT],
      autonomy: "automatic",
    });
    assert.equal(signed.ok, true);
    if (!signed.ok) return;

    const ok = executeDeviceActionWithReport({
      deviceToken: ex.token,
      action: signed.action,
      emergencyStopped: false,
      allowedRoots: [ROOT],
      autonomy: "automatic",
      binding: {
        claimedFingerprint: helpers.fingerprint,
        challenge: helpers.challenge,
        hmacProof: helpers.hmacProof,
      },
      run: () => ({ ok: true, detail: "read 12 bytes" }),
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.report.outcome, "success");
    assert.ok(ok.report.at);
    assert.match(ok.report.at, /T/);

    const badPath = signDeviceAction({
      deviceToken: ex.token,
      kind: "file_read",
      path: `${ROOT}\\a.txt`,
      allowedRoots: [ROOT],
      autonomy: "automatic",
    });
    assert.equal(badPath.ok, true);
    if (!badPath.ok) return;
    const forged = { ...badPath.action, path: "C:\\Windows\\System32\\cmd.exe", signature: badPath.action.signature };
    const rejected = executeDeviceActionWithReport({
      deviceToken: ex.token,
      action: forged,
      emergencyStopped: false,
      allowedRoots: [ROOT],
      autonomy: "automatic",
      binding: {
        claimedFingerprint: helpers.fingerprint,
        challenge: helpers.challenge,
        hmacProof: helpers.hmacProof,
      },
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.outcome, "rejected");
    assert.ok(rejected.report);
    assert.ok(rejected.report!.at);

    const reports = readPairingStore().reports;
    assert.ok(reports.length >= 2);
    assert.ok(reports.every((r) => r.at && r.outcome));
  });
});
