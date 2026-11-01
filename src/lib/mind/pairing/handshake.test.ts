import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setManagementKeyForTests } from "./management-key.ts";
import { setPairingStoreDirectory, resetPairingStoreForTests } from "./store.ts";
import {
  mintPairingCode,
  exchangePairingCode,
  findDeviceByToken,
  PAIRING_CODE_TTL_MS,
} from "./handshake.ts";

const PUB = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuDummyPublicKeyForTests\n-----END PUBLIC KEY-----`;

describe("pairing handshake", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pair-hs-"));
    setPairingStoreDirectory(dir);
    resetPairingStoreForTests();
    setManagementKeyForTests("test-management-key-not-real");
  });
  afterEach(() => {
    setManagementKeyForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("exchanges a valid code for a scoped device token", () => {
    const minted = mintPairingCode("user-1");
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    const exchanged = exchangePairingCode({
      code: minted.code,
      publicKeyPem: PUB,
      deviceName: "HP EliteBook",
    });
    assert.equal(exchanged.ok, true);
    if (!exchanged.ok) return;
    assert.ok(exchanged.token.length > 20);
    assert.deepEqual(exchanged.scopes, ["file-edit", "terminal"]);
    const found = findDeviceByToken(exchanged.token);
    assert.equal(found.ok, true);
  });

  it("rejects an expired code", () => {
    const now = Date.now();
    const minted = mintPairingCode("user-1", now);
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    const exchanged = exchangePairingCode({
      code: minted.code,
      publicKeyPem: PUB,
      deviceName: "HP",
      now: now + PAIRING_CODE_TTL_MS + 1000,
    });
    assert.equal(exchanged.ok, false);
    if (!exchanged.ok) assert.match(exchanged.error, /expired/i);
  });

  it("rejects a reused code", () => {
    const minted = mintPairingCode("user-1");
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    const first = exchangePairingCode({ code: minted.code, publicKeyPem: PUB, deviceName: "HP" });
    assert.equal(first.ok, true);
    const second = exchangePairingCode({ code: minted.code, publicKeyPem: PUB, deviceName: "HP" });
    assert.equal(second.ok, false);
    if (!second.ok) assert.match(second.error, /already used/i);
  });

  it("rejects a wrong code / wrong management key material", () => {
    const minted = mintPairingCode("user-1");
    assert.equal(minted.ok, true);
    const bad = exchangePairingCode({ code: "ZZZZ-ZZZZ", publicKeyPem: PUB, deviceName: "HP" });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /invalid/i);

    setManagementKeyForTests("different-key");
    if (!minted.ok) return;
    const wrongKey = exchangePairingCode({ code: minted.code, publicKeyPem: PUB, deviceName: "HP" });
    assert.equal(wrongKey.ok, false);
  });
});
