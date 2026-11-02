import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { encryptSecret } from "./crypto.ts";
import {
  clearStorageAccessTokenCache,
  mintStorageAccessToken,
  peekStorageAccessTokenCache,
  resolveStorageRefreshMaterial,
  storageAccessTokenCacheSize,
  ACCESS_TOKEN_EXPIRY_SKEW_MS,
} from "./storage-token-refresh.ts";
import {
  readConnection,
  setConnectorDirectory,
  storeAccessToken,
  getAccessToken,
  getRefreshToken,
} from "./store.ts";
import {
  resolveStorageAccessToken,
  resolveStorageAccessTokenAsync,
  setStorageConnectorDirectory,
  storageRecordPath,
} from "../media/storage/credentials.ts";

const SECRET = "unit-test-connector-secret-32b";

describe("storage token refresh", () => {
  let prevSecret: string | undefined;
  let dir: string;

  beforeEach(() => {
    prevSecret = process.env.CONNECTOR_TOKEN_SECRET;
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    dir = mkdtempSync(join(tmpdir(), "mind-storage-refresh-"));
    setConnectorDirectory(dir);
    setStorageConnectorDirectory(dir);
    clearStorageAccessTokenCache();
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.CONNECTOR_TOKEN_SECRET;
    else process.env.CONNECTOR_TOKEN_SECRET = prevSecret;
    clearStorageAccessTokenCache();
  });

  it("keeps StoredConnection encrypted on disk (no plaintext tokens)", () => {
    storeAccessToken({
      ownerId: "owner-1",
      connector: "google_drive",
      accessToken: "access-PLAIN-should-not-appear",
      refreshToken: "refresh-PLAIN-should-not-appear",
      accountLabel: "drive-test",
    });
    const path = storageRecordPath("owner-1", "google_drive");
    assert.equal(existsSync(path), true);
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes("access-PLAIN"), false);
    assert.equal(raw.includes("refresh-PLAIN"), false);
    assert.match(raw, /accessTokenEnc/);
    assert.match(raw, /refreshTokenEnc/);
    const conn = readConnection("owner-1", "google_drive");
    assert.ok(conn);
    assert.equal(getAccessToken("owner-1", "google_drive"), "access-PLAIN-should-not-appear");
    assert.equal(getRefreshToken("owner-1", "google_drive"), "refresh-PLAIN-should-not-appear");
  });

  it("mints via refresh endpoint, caches until skew, and never puts tokens in errors", async () => {
    storeAccessToken({
      ownerId: "owner-2",
      connector: "dropbox",
      accessToken: "stale-access",
      refreshToken: "refresh-secret-VALUE",
    });

    let calls = 0;
    const fetchMock = async (_url: string, init?: RequestInit) => {
      calls += 1;
      const body = String(init?.body || "");
      assert.match(body, /grant_type=refresh_token/);
      assert.match(body, /refresh_token=refresh-secret-VALUE/);
      assert.match(body, /client_id=dbx-client/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "minted-access-TOKEN",
          expires_in: 120,
          token_type: "bearer",
        }),
        text: async () => "",
      };
    };

    const env = {
      DROPBOX_OAUTH_CLIENT_ID: "dbx-client",
      DROPBOX_OAUTH_CLIENT_SECRET: "dbx-secret",
    };

    const first = await mintStorageAccessToken("owner-2", "dropbox", {
      env,
      fetch: fetchMock,
      nowMs: 1_000_000,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.accessToken, "minted-access-TOKEN");
    assert.equal(first.source, "refresh");
    assert.equal(calls, 1);

    const cached = await mintStorageAccessToken("owner-2", "dropbox", {
      env,
      fetch: fetchMock,
      nowMs: 1_000_000 + 10_000, // still inside 120s - 60s skew
    });
    assert.equal(cached.ok, true);
    if (!cached.ok) return;
    assert.equal(cached.source, "cache");
    assert.equal(calls, 1);

    // Past skew window → refresh again
    const refreshed = await mintStorageAccessToken("owner-2", "dropbox", {
      env,
      fetch: fetchMock,
      nowMs: 1_000_000 + (120_000 - ACCESS_TOKEN_EXPIRY_SKEW_MS) + 1,
    });
    assert.equal(refreshed.ok, true);
    if (!refreshed.ok) return;
    assert.equal(refreshed.source, "refresh");
    assert.equal(calls, 2);
    assert.equal(storageAccessTokenCacheSize(), 1);
    assert.equal(peekStorageAccessTokenCache("owner-2", "dropbox").hit, true);
  });

  it("failed refresh returns honest error without token leakage", async () => {
    const env = {
      GOOGLE_OAUTH_CLIENT_ID: "g-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "g-secret",
      MIND_GOOGLE_DRIVE_REFRESH_TOKEN: "env-refresh-LEAK-ME",
    };
    const fetchMock = async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: "invalid_grant",
        error_description: "Token has been expired or revoked: env-refresh-LEAK-ME",
        access_token: "should-not-surface",
      }),
      text: async () => JSON.stringify({ access_token: "should-not-surface", refresh_token: "env-refresh-LEAK-ME" }),
    });

    const result = await mintStorageAccessToken("owner-3", "google_drive", {
      env,
      fetch: fetchMock,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /refresh failed/i);
    assert.match(result.error, /HTTP 400/);
    assert.equal(result.error.includes("env-refresh-LEAK-ME"), false);
    assert.equal(result.error.includes("should-not-surface"), false);
    assert.equal(result.error.includes("g-secret"), false);

    const asyncResolve = await resolveStorageAccessTokenAsync("owner-3", "google_drive", {
      env,
      fetch: fetchMock,
    });
    assert.equal(asyncResolve.ok, false);
    if (asyncResolve.ok) return;
    assert.equal(asyncResolve.reason, "refresh_failed");
    assert.equal(asyncResolve.detail.includes("env-refresh-LEAK-ME"), false);
    assert.equal(JSON.stringify(asyncResolve).includes("env-refresh-LEAK-ME"), false);
  });

  it("supports env refresh token material without a stored record", () => {
    const material = resolveStorageRefreshMaterial("nobody", "onedrive", {
      MICROSOFT_OAUTH_CLIENT_ID: "ms-id",
      MICROSOFT_OAUTH_CLIENT_SECRET: "ms-secret",
      MIND_ONEDRIVE_REFRESH_TOKEN: "ms-refresh",
    });
    assert.equal(material.ok, true);
    if (!material.ok) return;
    assert.equal(material.source, "env");
    assert.equal(material.refreshToken, "ms-refresh");
  });

  it("keeps plain MIND_*_TOKEN access-token behavior", () => {
    const result = resolveStorageAccessToken("owner", "google_drive", {
      MIND_GOOGLE_DRIVE_TOKEN: "plain-access",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.source, "env");
    assert.equal(result.token, "plain-access");
  });

  it("async resolver prefers refresh over stale encrypted access when refresh is configured", async () => {
    storeAccessToken({
      ownerId: "owner-4",
      connector: "google_drive",
      accessToken: "old-access",
      refreshToken: "refresh-ok",
    });
    let calls = 0;
    const fetchMock = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "fresh-access", expires_in: 3600 }),
        text: async () => "",
      };
    };
    const result = await resolveStorageAccessTokenAsync("owner-4", "google_drive", {
      env: {
        GOOGLE_OAUTH_CLIENT_ID: "id",
        GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      },
      fetch: fetchMock,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.token, "fresh-access");
    assert.equal(result.source, "refresh");
    assert.equal(calls, 1);
  });

  it("encryptSecret ciphertext format stays iv.tag.data", () => {
    const { ciphertext } = encryptSecret("hello-token", SECRET);
    const parts = ciphertext.split(".");
    assert.equal(parts.length, 3);
    assert.ok(parts.every((p) => p.length > 0));
  });
});
