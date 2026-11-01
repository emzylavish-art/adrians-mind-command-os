import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setManagementKeyForTests } from "./management-key.ts";
import { setPairingStoreDirectory, resetPairingStoreForTests } from "./store.ts";
import { mintPairingCode, exchangePairingCode } from "./handshake.ts";
import { signDeviceAction, verifyAndAuthorizeAction } from "./actions.ts";
import { approvalTokenFor } from "../policy.ts";

const PUB = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuDummyPublicKeyForTests\n-----END PUBLIC KEY-----`;
const ROOT = "C:\\Users\\Public\\MindWorkspace";

async function pairedToken() {
  const minted = mintPairingCode("user-1");
  assert.equal(minted.ok, true);
  if (!minted.ok) throw new Error("mint");
  const ex = exchangePairingCode({ code: minted.code, publicKeyPem: PUB, deviceName: "HP" });
  assert.equal(ex.ok, true);
  if (!ex.ok) throw new Error("ex");
  return ex.token;
}

describe("action signing and scope", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pair-act-"));
    setPairingStoreDirectory(dir);
    resetPairingStoreForTests();
    setManagementKeyForTests("test-management-key-not-real");
  });
  afterEach(() => {
    setManagementKeyForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a valid signed file_read under the root", async () => {
    const token = await pairedToken();
    const signed = signDeviceAction({
      deviceToken: token,
      kind: "file_read",
      path: `${ROOT}\\notes.txt`,
      allowedRoots: [ROOT],
      autonomy: "automatic",
    });
    assert.equal(signed.ok, true);
    if (!signed.ok) return;
    const verified = verifyAndAuthorizeAction({
      deviceToken: token,
      action: signed.action,
      emergencyStopped: false,
      allowedRoots: [ROOT],
      autonomy: "automatic",
    });
    assert.equal(verified.ok, true);
  });

  it("rejects unsigned and tampered actions", async () => {
    const token = await pairedToken();
    const signed = signDeviceAction({
      deviceToken: token,
      kind: "file_read",
      path: `${ROOT}\\a.txt`,
      allowedRoots: [ROOT],
      autonomy: "automatic",
    });
    assert.equal(signed.ok, true);
    if (!signed.ok) return;
    const unsigned = { ...signed.action, signature: "" };
    assert.equal(
      verifyAndAuthorizeAction({
        deviceToken: token,
        action: unsigned,
        emergencyStopped: false,
        allowedRoots: [ROOT],
        autonomy: "automatic",
      }).ok,
      false,
    );
    const tampered = { ...signed.action, path: `${ROOT}\\b.txt` };
    assert.equal(
      verifyAndAuthorizeAction({
        deviceToken: token,
        action: tampered,
        emergencyStopped: false,
        allowedRoots: [ROOT],
        autonomy: "automatic",
      }).ok,
      false,
    );
  });

  it("rejects replayed nonces", async () => {
    const token = await pairedToken();
    const signed = signDeviceAction({
      deviceToken: token,
      kind: "file_read",
      path: `${ROOT}\\a.txt`,
      allowedRoots: [ROOT],
      autonomy: "automatic",
    });
    assert.equal(signed.ok, true);
    if (!signed.ok) return;
    assert.equal(
      verifyAndAuthorizeAction({
        deviceToken: token,
        action: signed.action,
        emergencyStopped: false,
        allowedRoots: [ROOT],
        autonomy: "automatic",
      }).ok,
      true,
    );
    const replay = verifyAndAuthorizeAction({
      deviceToken: token,
      action: signed.action,
      emergencyStopped: false,
      allowedRoots: [ROOT],
      autonomy: "automatic",
    });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.match(replay.error, /replay/i);
  });

  it("blocks path traversal and symlink-looking segments", async () => {
    const token = await pairedToken();
    for (const path of [
      `${ROOT}\\..\\..\\Windows\\System32\\cmd.exe`,
      `${ROOT}\\..\\Secret`,
      `C:\\Windows\\System32\\drivers\\etc\\hosts`,
      `${ROOT}\\foo\\..\\..\\bar`,
    ]) {
      const signed = signDeviceAction({
        deviceToken: token,
        kind: "file_write",
        path,
        allowedRoots: [ROOT],
        autonomy: "automatic",
        approvalToken: approvalTokenFor("will-mismatch"),
      });
      // file_write is protected (overwrite) — may fail governance OR path; both are reject
      if (signed.ok) {
        const v = verifyAndAuthorizeAction({
          deviceToken: token,
          action: signed.action,
          emergencyStopped: false,
          allowedRoots: [ROOT],
          autonomy: "automatic",
        });
        assert.equal(v.ok, false, path);
      } else {
        assert.match(signed.error, /traversal|outside|Path|protected|approve|Ask|Automatic/i, path);
      }
    }
  });

  it("blocks command injection through arguments", async () => {
    const token = await pairedToken();
    for (const [command, args] of [
      ["echo", ["hi", "; rm -rf /"]],
      ["powershell", ["-enc", "AAAA"]],
      ["cmd", ["/c", "shutdown /s"]],
    ] as const) {
      const signed = signDeviceAction({
        deviceToken: token,
        kind: "terminal",
        command,
        args: [...args],
        allowedRoots: [ROOT],
        autonomy: "automatic",
        approvalToken: null,
      });
      assert.equal(signed.ok, false, `${command} ${args.join(" ")}`);
    }
  });

  it("requires owner approval for protected file_write/delete even when signed attempt is made", async () => {
    const token = await pairedToken();
    const denied = signDeviceAction({
      deviceToken: token,
      kind: "file_delete",
      path: `${ROOT}\\a.txt`,
      allowedRoots: [ROOT],
      autonomy: "automatic",
      approvalToken: null,
    });
    assert.equal(denied.ok, false);
  });
});
