import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setManagementKeyForTests } from "./management-key.ts";
import { setPairingStoreDirectory, resetPairingStoreForTests } from "./store.ts";
import { mintPairingCode, exchangePairingCode, HEARTBEAT_FRESH_MS } from "./handshake.ts";
import { pairingCardState, recordHeartbeat, pcCapabilityFromPairing, pairingCardFromApi } from "./status.ts";

const PUB = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuDummyPublicKeyForTests\n-----END PUBLIC KEY-----`;

describe("pairing card state", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pair-st-"));
    setPairingStoreDirectory(dir);
    resetPairingStoreForTests();
    setManagementKeyForTests("test-management-key-not-real");
  });
  afterEach(() => {
    setManagementKeyForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("shows Not paired with no device", () => {
    const card = pairingCardState("user-1");
    assert.equal(card.paired, false);
    assert.equal(card.label, "Not paired");
    assert.equal(card.fileEditEnabled, false);
    assert.equal(pcCapabilityFromPairing("user-1").status, "blocked");
  });

  it("shows Connected only with valid token and fresh heartbeat", () => {
    const minted = mintPairingCode("user-1");
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    const ex = exchangePairingCode({ code: minted.code, publicKeyPem: PUB, deviceName: "HP EliteBook" });
    assert.equal(ex.ok, true);
    if (!ex.ok) return;
    // handshake sets an initial heartbeat
    let card = pairingCardState("user-1");
    assert.equal(card.paired, true);
    if (card.paired) {
      assert.equal(card.deviceName, "HP EliteBook");
      assert.equal(card.fileEditEnabled, true);
    }
    assert.equal(pcCapabilityFromPairing("user-1").status, "ready");

    // Stale heartbeat → Not paired (honest)
    card = pairingCardState("user-1", Date.now() + HEARTBEAT_FRESH_MS + 5_000);
    assert.equal(card.paired, false);

    // Fresh heartbeat restores
    recordHeartbeat(ex.token);
    card = pairingCardState("user-1");
    assert.equal(card.paired, true);
  });

  it("pairingCardFromApi never invents Connected", () => {
    const empty = pairingCardFromApi(null);
    assert.equal(empty.paired, false);
    const bad = pairingCardFromApi({ card: undefined });
    assert.equal(bad.paired, false);
  });
});
