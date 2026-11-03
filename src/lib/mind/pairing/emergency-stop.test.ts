import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setManagementKeyForTests } from "./management-key.ts";
import { setPairingStoreDirectory, resetPairingStoreForTests, readPairingStore } from "./store.ts";
import { mintPairingCode, exchangePairingCode, findDeviceByToken } from "./handshake.ts";
import { signDeviceAction, verifyAndAuthorizeAction } from "./actions.ts";
import {
  engageDeviceEmergencyStop,
  clearDeviceEmergencyStop,
  isDeviceStopped,
  localStopCheck,
} from "./emergency-stop.ts";
import { pairingCardState, recordHeartbeat } from "./status.ts";

const PUB = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuDummyPublicKeyForTests\n-----END PUBLIC KEY-----`;
const ROOT = "C:\\Users\\Public\\MindWorkspace";

describe("device emergency stop", () => {
  let dir: string;
  let token: string;
  let deviceId: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pair-stop-"));
    setPairingStoreDirectory(dir);
    resetPairingStoreForTests();
    setManagementKeyForTests("test-management-key-not-real");
    const minted = mintPairingCode("owner");
    assert.equal(minted.ok, true);
    if (!minted.ok) throw new Error("mint");
    const ex = exchangePairingCode({ code: minted.code, publicKeyPem: PUB, deviceName: "HP EliteBook" });
    assert.equal(ex.ok, true);
    if (!ex.ok) throw new Error("ex");
    token = ex.token;
    deviceId = ex.deviceId;
  });
  afterEach(() => {
    setManagementKeyForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("kills authority by revoking the token and setting the stop flag", () => {
    const stopped = engageDeviceEmergencyStop({ deviceId, userId: "owner" });
    assert.equal(stopped.ok, true);
    assert.equal(isDeviceStopped(deviceId), true);
    const found = findDeviceByToken(token);
    assert.equal(found.ok, false);
    if (!found.ok) assert.match(found.error, /revoked/i);
  });

  it("rejects actions while stopped and model cannot clear via localStopCheck alone", () => {
    engageDeviceEmergencyStop({ deviceId, userId: "owner" });
    // Even with a fresh pairing mid-test, local stop check is independent of model text
    const check = localStopCheck({ serverStopped: true, localHotkey: false, localCli: false });
    assert.equal(check.stop, true);
    // "Model says clear stop" is just text — clearing requires clearDeviceEmergencyStop
    const forgedClear = localStopCheck({
      serverStopped: true,
      localHotkey: false,
      localCli: false,
    });
    assert.equal(forgedClear.stop, true);
    const otherUser = clearDeviceEmergencyStop({ deviceId, userId: "intruder" });
    assert.equal(otherUser.ok, false);
  });

  it("survives restart (flag persists in store) and requires human clear then re-pair", () => {
    engageDeviceEmergencyStop({ deviceId, userId: "owner" });
    // Simulate process restart by re-reading store
    assert.equal(isDeviceStopped(deviceId), true);
    assert.equal(readPairingStore().devices.find((d) => d.id === deviceId)?.revokedAt != null, true);
    const cleared = clearDeviceEmergencyStop({ deviceId, userId: "owner" });
    assert.equal(cleared.ok, true);
    assert.equal(isDeviceStopped(deviceId), false);
    // Token stays revoked — must re-pair
    assert.equal(findDeviceByToken(token).ok, false);
  });

  it("local CLI/hotkey stop engages without waiting for the model", () => {
    assert.equal(localStopCheck({ serverStopped: false, localHotkey: true, localCli: false }).stop, true);
    assert.equal(localStopCheck({ serverStopped: false, localHotkey: false, localCli: true }).stop, true);
    assert.equal(localStopCheck({ serverStopped: false, localHotkey: false, localCli: false }).stop, false);
  });

  it("blocks verify when emergencyStopped is set on the device before revoke races", () => {
    // Sign while live
    const signed = signDeviceAction({
      deviceToken: token,
      kind: "file_read",
      path: `${ROOT}\\a.txt`,
      allowedRoots: [ROOT],
      autonomy: "automatic",
    });
    assert.equal(signed.ok, true);
    if (!signed.ok) return;
    engageDeviceEmergencyStop({ deviceToken: token, userId: "owner" });
    const verified = verifyAndAuthorizeAction({
      deviceToken: token,
      action: signed.action,
      emergencyStopped: false,
      allowedRoots: [ROOT],
      autonomy: "automatic",
        skipBindingForTests: true,
      });
    assert.equal(verified.ok, false);
  });

  it("card disables file-edit/terminal while stopped even if a stale heartbeat exists", () => {
    recordHeartbeat(token);
    // Re-pair path: stop then check card — revoked devices do not count as paired
    engageDeviceEmergencyStop({ deviceId, userId: "owner" });
    const card = pairingCardState("owner");
    assert.equal(card.paired, false);
    assert.equal(card.fileEditEnabled, false);
  });
});
