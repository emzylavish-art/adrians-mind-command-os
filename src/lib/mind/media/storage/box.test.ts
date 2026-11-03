import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  clearStorageAccessTokenCache,
  mintStorageAccessToken,
} from "../../connectors/storage-token-refresh.ts";
import {
  getRefreshToken,
  getAccessToken,
  readConnection,
  setConnectorDirectory,
  storeAccessToken,
} from "../../connectors/store.ts";
import { validateOAuthTokenUrl } from "../../connectors/oauth-provider.ts";
import {
  resolveStorageAccessTokenAsync,
  setStorageConnectorDirectory,
  storageRecordPath,
} from "./credentials.ts";
import { createBoxProvider } from "./providers/box.ts";

const SECRET = "unit-test-box-connector-secret-32b";

describe("Box storage provider", () => {
  let prevSecret: string | undefined;
  let dir: string;

  beforeEach(() => {
    prevSecret = process.env.CONNECTOR_TOKEN_SECRET;
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    dir = mkdtempSync(join(tmpdir(), "mind-box-"));
    setConnectorDirectory(dir);
    setStorageConnectorDirectory(dir);
    clearStorageAccessTokenCache();
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.CONNECTOR_TOKEN_SECRET;
    else process.env.CONNECTOR_TOKEN_SECRET = prevSecret;
    clearStorageAccessTokenCache();
  });

  it("allowlists api.box.com / app.box.com token hosts and rejects lookalikes", () => {
    assert.equal(validateOAuthTokenUrl("box", "https://api.box.com/oauth2/token").ok, true);
    assert.equal(validateOAuthTokenUrl("box", "https://app.box.com/api/oauth2/token").ok, true);
    assert.equal(validateOAuthTokenUrl("box", "https://evil.box.com/oauth2/token").ok, false);
    assert.equal(validateOAuthTokenUrl("box", "https://api.box.com.evil.example/oauth2/token").ok, false);
    assert.equal(validateOAuthTokenUrl("box", "http://api.box.com/oauth2/token").ok, false);
  });

  it("persists rotated refresh token atomically and keeps ciphertext off plaintext disk", async () => {
    storeAccessToken({
      ownerId: "owner-box",
      connector: "box",
      accessToken: "stale-access-PLAIN",
      refreshToken: "old-refresh-PLAIN-should-rotate",
      accountLabel: "emzylavish@gmail.com",
    });
    const path = storageRecordPath("owner-box", "box");
    assert.equal(existsSync(path), true);
    const beforeRaw = readFileSync(path, "utf8");
    assert.equal(beforeRaw.includes("old-refresh-PLAIN"), false);
    assert.equal(beforeRaw.includes("stale-access-PLAIN"), false);

    let calls = 0;
    const fetchMock = async (_url: string, init?: RequestInit) => {
      calls += 1;
      const body = String(init?.body || "");
      assert.match(body, /grant_type=refresh_token/);
      assert.match(body, /refresh_token=old-refresh-PLAIN-should-rotate/);
      assert.equal(init?.redirect, "manual");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "new-access-TOKEN",
          refresh_token: "new-refresh-ROTATED-TOKEN",
          expires_in: 3600,
          token_type: "bearer",
        }),
        text: async () => "",
      };
    };

    const minted = await mintStorageAccessToken("owner-box", "box", {
      env: {
        BOX_OAUTH_CLIENT_ID: "box-client",
        BOX_OAUTH_CLIENT_SECRET: "box-secret",
      },
      fetch: fetchMock,
      persistRotated: true,
    });
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    assert.equal(minted.accessToken, "new-access-TOKEN");
    assert.equal(calls, 1);

    assert.equal(getRefreshToken("owner-box", "box"), "new-refresh-ROTATED-TOKEN");
    assert.equal(getAccessToken("owner-box", "box"), "new-access-TOKEN");
    const afterRaw = readFileSync(path, "utf8");
    assert.equal(afterRaw.includes("new-refresh-ROTATED-TOKEN"), false);
    assert.equal(afterRaw.includes("new-access-TOKEN"), false);
    assert.equal(afterRaw.includes("old-refresh-PLAIN"), false);
    assert.match(afterRaw, /refreshTokenEnc/);
  });

  it("failed refresh does not wipe the encrypted record and never leaks tokens", async () => {
    storeAccessToken({
      ownerId: "owner-box-fail",
      connector: "box",
      accessToken: "keep-access",
      refreshToken: "keep-refresh-LEAK-ME",
      accountLabel: "box-user",
    });
    const before = readConnection("owner-box-fail", "box");
    assert.ok(before);
    const beforeRefreshEnc = before!.refreshTokenEnc;
    const beforeAccessEnc = before!.accessTokenEnc;

    const result = await mintStorageAccessToken("owner-box-fail", "box", {
      env: {
        BOX_OAUTH_CLIENT_ID: "box-client",
        BOX_OAUTH_CLIENT_SECRET: "box-secret",
      },
      fetch: async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: "invalid_grant",
          error_description: "Refresh token has already been used: keep-refresh-LEAK-ME",
          access_token: "should-not-surface",
          refresh_token: "should-not-persist",
        }),
        text: async () => "keep-refresh-LEAK-ME should-not-surface",
      }),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /HTTP 400/);
    assert.equal(result.error.includes("keep-refresh-LEAK-ME"), false);
    assert.equal(result.error.includes("should-not-surface"), false);
    assert.equal(result.error.includes("box-secret"), false);

    const after = readConnection("owner-box-fail", "box");
    assert.ok(after);
    assert.equal(after!.refreshTokenEnc, beforeRefreshEnc);
    assert.equal(after!.accessTokenEnc, beforeAccessEnc);
    assert.equal(getRefreshToken("owner-box-fail", "box"), "keep-refresh-LEAK-ME");
    assert.equal(getAccessToken("owner-box-fail", "box"), "keep-access");
  });

  it("upload uses multipart attributes parent and never leaks token in errors", async () => {
    const token = "box-access-token-SECRET-value-xyz";
    let sawUpload = false;
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/folders") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "111", type: "folder", name: "AdriansMind" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("upload.box.com")) {
        sawUpload = true;
        assert.equal(init?.method, "POST");
        assert.equal(init?.redirect, "manual");
        const auth = String((init?.headers as Record<string, string>)?.authorization || "");
        assert.match(auth, /Bearer /);
        // Fail path: body FormData filename fail.txt
        const body: any = init?.body;
        const bodyStr = typeof body === "string" ? body : "";
        // Always succeed first upload; second call uses failFlag
        if ((fetchMock as any)._failNext) {
          return new Response(JSON.stringify({ error: `bad ${token}` }), { status: 500 });
        }
        return new Response(
          JSON.stringify({ entries: [{ id: "2567208779245", name: "x.txt" }] }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: `bad ${token}` }), { status: 500 });
    };

    const provider = createBoxProvider(fetchMock);
    const uploaded = await provider.upload({
      accessToken: token,
      bytes: new TextEncoder().encode("hi"),
      fileName: "x.txt",
      mimeType: "text/plain",
      folderSegments: [],
    });
    assert.equal(sawUpload, true);
    assert.equal(uploaded.remoteId, "2567208779245");
    assert.equal(uploaded.service, "box");

    (fetchMock as any)._failNext = true;
    await assert.rejects(
      () =>
        provider.upload({
          accessToken: token,
          bytes: new TextEncoder().encode("x"),
          fileName: "fail.txt",
          mimeType: "text/plain",
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.equal(msg.includes(token), false);
        assert.match(msg, /HTTP/);
        return true;
      },
    );
  });

  it("async resolver refreshes via box token endpoint", async () => {
    storeAccessToken({
      ownerId: "owner-box-async",
      connector: "box",
      accessToken: "old",
      refreshToken: "refresh-ok",
    });
    const result = await resolveStorageAccessTokenAsync("owner-box-async", "box", {
      env: {
        BOX_OAUTH_CLIENT_ID: "id",
        BOX_OAUTH_CLIENT_SECRET: "secret",
      },
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "fresh-box",
          refresh_token: "rotated-box",
          expires_in: 3600,
        }),
        text: async () => "",
      }),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.token, "fresh-box");
      assert.equal(result.source, "refresh");
    }
    assert.equal(getRefreshToken("owner-box-async", "box"), "rotated-box");
  });
});
