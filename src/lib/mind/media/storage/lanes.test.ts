import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setConnectorDirectory, storeAccessToken } from "../../connectors/store.ts";
import { setStorageAccountsConfigPath } from "./config.ts";
import { setStorageConnectorDirectory } from "./credentials.ts";
import {
  assertValidLaneId,
  InvalidStorageLaneIdError,
  isolateEnvForStorageAccount,
  laneEnvKey,
  resolveStorageAccessTokenForAccountSync,
  resolveStorageLaneAccessToken,
} from "./lanes.ts";
import type { StorageAccountConfig } from "./types.ts";

function writeAccounts(dir: string, accounts: StorageAccountConfig[]) {
  const path = join(dir, "accounts.json");
  writeFileSync(path, JSON.stringify({ version: 1, switchThreshold: 0.9, accounts }), "utf8");
  setStorageAccountsConfigPath(path);
  return path;
}

describe("storage lane id validation", () => {
  it("accepts fleet-style lane ids", () => {
    assert.equal(assertValidLaneId("gdrive-emmanuelohilebo4"), "gdrive-emmanuelohilebo4");
    assert.equal(assertValidLaneId("onedrive-emmanuelohilebo4"), "onedrive-emmanuelohilebo4");
    assert.equal(assertValidLaneId("gdrive-emzylavish"), "gdrive-emzylavish");
  });

  it("rejects path traversal and separators", () => {
    const bad = [
      "../etc/passwd",
      "..",
      "gdrive/../secret",
      "gdrive\\emmanuel",
      "gdrive/emmanuel",
      "a:b",
      "lane%2fxx",
      "has spaces",
      "",
      "a".repeat(65),
      "/abs",
      "trailing-",
      "-leading",
    ];
    for (const id of bad) {
      assert.throws(() => assertValidLaneId(id), InvalidStorageLaneIdError, id);
    }
  });

  it("laneEnvKey refuses traversal before building an env name", () => {
    assert.throws(() => laneEnvKey("../x", "TOKEN"), InvalidStorageLaneIdError);
    assert.equal(
      laneEnvKey("gdrive-emmanuelohilebo4", "REFRESH_TOKEN"),
      "MIND_STORAGE_LANE_GDRIVE_EMMANUELOHILEBO4_REFRESH_TOKEN",
    );
  });
});

describe("storage lane credential isolation", () => {
  it("does not let one lane resolve another lane's env token", () => {
    const laneA: StorageAccountConfig = {
      service: "google_drive",
      accountEmail: "a@example.com",
      capBytes: 1000,
      order: 1,
      enabled: true,
      laneId: "gdrive-alpha",
      credentialOwnerId: "owner-a@example.com",
    };
    const laneB: StorageAccountConfig = {
      service: "google_drive",
      accountEmail: "b@example.com",
      capBytes: 1000,
      order: 2,
      enabled: true,
      laneId: "gdrive-beta",
      credentialOwnerId: "owner-b@example.com",
    };

    const env = {
      MIND_GOOGLE_DRIVE_TOKEN: "generic-should-not-leak",
      MIND_GOOGLE_DRIVE_REFRESH_TOKEN: "generic-refresh-should-not-leak",
      [laneEnvKey("gdrive-alpha", "TOKEN")]: "token-for-alpha-only",
      [laneEnvKey("gdrive-beta", "TOKEN")]: "token-for-beta-only",
    };

    const isolatedA = isolateEnvForStorageAccount(env, laneA, "signed-in@example.com");
    const isolatedB = isolateEnvForStorageAccount(env, laneB, "signed-in@example.com");

    assert.equal(isolatedA.MIND_GOOGLE_DRIVE_TOKEN, "token-for-alpha-only");
    assert.equal(isolatedB.MIND_GOOGLE_DRIVE_TOKEN, "token-for-beta-only");
    assert.notEqual(isolatedA.MIND_GOOGLE_DRIVE_TOKEN, isolatedB.MIND_GOOGLE_DRIVE_TOKEN);
    assert.equal(isolatedA.MIND_GOOGLE_DRIVE_REFRESH_TOKEN, undefined);
    assert.equal(isolatedB.MIND_GOOGLE_DRIVE_REFRESH_TOKEN, undefined);

    const syncA = resolveStorageAccessTokenForAccountSync("signed-in@example.com", laneA, env);
    const syncB = resolveStorageAccessTokenForAccountSync("signed-in@example.com", laneB, env);
    assert.equal(syncA.ok, true);
    assert.equal(syncB.ok, true);
    if (syncA.ok && syncB.ok) {
      assert.equal(syncA.token, "token-for-alpha-only");
      assert.equal(syncB.token, "token-for-beta-only");
      assert.notEqual(syncA.token, syncB.token);
    }
  });

  it("strips generic env when credentialOwnerId differs even without laneId", () => {
    const account: StorageAccountConfig = {
      service: "onedrive",
      accountEmail: "emmanuelohilebo4@gmail.com",
      capBytes: 1000,
      order: 1,
      enabled: true,
      credentialOwnerId: "emmanuelohilebo4@gmail.com",
    };
    const env = {
      MIND_ONEDRIVE_TOKEN: "emzylavish-break-glass",
      MIND_ONEDRIVE_REFRESH_TOKEN: "emzylavish-refresh",
    };
    const isolated = isolateEnvForStorageAccount(env, account, "emzylavish@gmail.com");
    assert.equal(isolated.MIND_ONEDRIVE_TOKEN, undefined);
    assert.equal(isolated.MIND_ONEDRIVE_REFRESH_TOKEN, undefined);
  });

  it("resolves encrypted records per credentialOwnerId and never cross-reads", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-lanes-"));
    const connectors = join(dir, "connectors");
    mkdirSync(connectors, { recursive: true });
    setStorageConnectorDirectory(connectors);
    setConnectorDirectory(connectors);

    // CONNECTOR_TOKEN_SECRET required for encryption
    process.env.CONNECTOR_TOKEN_SECRET = randomBytes(32).toString("base64url");

    storeAccessToken({
      ownerId: "owner-a@example.com",
      connector: "google_drive",
      accessToken: "access-token-owner-a",
      refreshToken: "refresh-token-owner-a",
      accountLabel: "owner-a@example.com",
    });
    storeAccessToken({
      ownerId: "owner-b@example.com",
      connector: "google_drive",
      accessToken: "access-token-owner-b",
      refreshToken: "refresh-token-owner-b",
      accountLabel: "owner-b@example.com",
    });

    writeAccounts(dir, [
      {
        service: "google_drive",
        accountEmail: "owner-a@example.com",
        capBytes: 1000,
        order: 1,
        enabled: true,
        laneId: "gdrive-alpha",
        credentialOwnerId: "owner-a@example.com",
      },
      {
        service: "google_drive",
        accountEmail: "owner-b@example.com",
        capBytes: 1000,
        order: 2,
        enabled: true,
        laneId: "gdrive-beta",
        credentialOwnerId: "owner-b@example.com",
      },
    ]);

    const env = {
      // Would poison both lanes if isolation failed:
      MIND_GOOGLE_DRIVE_TOKEN: "generic-poison",
    };

    const a = await resolveStorageLaneAccessToken("gdrive-alpha", {
      fallbackOwnerId: "signed-in@example.com",
      env,
      configPath: join(dir, "accounts.json"),
    });
    const b = await resolveStorageLaneAccessToken("gdrive-beta", {
      fallbackOwnerId: "signed-in@example.com",
      env,
      configPath: join(dir, "accounts.json"),
    });

    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (a.ok && b.ok) {
      assert.equal(a.token, "access-token-owner-a");
      assert.equal(b.token, "access-token-owner-b");
      assert.notEqual(a.token, b.token);
    }

    // Unknown / traversal lane ids fail closed
    const missing = await resolveStorageLaneAccessToken("gdrive-missing", {
      fallbackOwnerId: "signed-in@example.com",
      env,
      configPath: join(dir, "accounts.json"),
    });
    assert.equal(missing.ok, false);

    const traversal = await resolveStorageLaneAccessToken("../etc/passwd", {
      fallbackOwnerId: "signed-in@example.com",
      env,
      configPath: join(dir, "accounts.json"),
    });
    assert.equal(traversal.ok, false);

    // Owner hash dirs are distinct
    const hashA = createHash("sha256").update("owner-a@example.com").digest("hex");
    const hashB = createHash("sha256").update("owner-b@example.com").digest("hex");
    assert.notEqual(hashA, hashB);
  });
});
