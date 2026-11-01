import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setManagementKeyForTests } from "./management-key.ts";
import { setPairingStoreDirectory, resetPairingStoreForTests } from "./store.ts";
import {
  hashContent,
  signAgentManifest,
  verifyAgentManifestSignature,
  verifyAgentFiles,
} from "./integrity.ts";

describe("signed agent manifest", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pair-man-"));
    setPairingStoreDirectory(dir);
    resetPairingStoreForTests();
    setManagementKeyForTests("test-management-key-not-real");
  });
  afterEach(() => {
    setManagementKeyForTests(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("signs and verifies a manifest; tamper fails", () => {
    const files = { "MindAgent.ps1": hashContent("agent-v1"), "Emergency-Stop.ps1": hashContent("stop-v1") };
    const signed = signAgentManifest(files);
    assert.equal(signed.ok, true);
    if (!signed.ok) return;
    assert.ok(signed.manifest.signature);
    assert.equal(verifyAgentManifestSignature(signed.manifest).ok, true);
    assert.equal(verifyAgentFiles(files, signed.manifest).ok, true);

    const tampered = { ...signed.manifest, files: { ...files, "MindAgent.ps1": hashContent("evil") } };
    assert.equal(verifyAgentManifestSignature(tampered).ok, false);

    const badSig = { ...signed.manifest, signature: "0".repeat(64) };
    assert.equal(verifyAgentFiles(files, badSig).ok, false);
  });

  it("rejects missing signature when required", () => {
    const files = { "MindAgent.ps1": hashContent("x") };
    const unsigned = { version: "1", files };
    assert.equal(verifyAgentFiles(files, unsigned, { requireSignature: true }).ok, false);
    assert.equal(verifyAgentFiles(files, unsigned, { requireSignature: false }).ok, true);
  });
});
