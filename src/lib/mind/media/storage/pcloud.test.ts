import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { storeAccessToken, setConnectorDirectory, getAccessToken } from "../../connectors/store.ts";
import {
  resolveStorageAccessToken,
  resolveStorageAccessTokenAsync,
  setStorageConnectorDirectory,
  storageRecordPath,
} from "./credentials.ts";
import { createPcloudProvider, resolvePcloudApiHost } from "./providers/pcloud.ts";

const SECRET = "unit-test-pcloud-connector-secret";

describe("pCloud storage provider", () => {
  let prevSecret: string | undefined;
  let dir: string;

  beforeEach(() => {
    prevSecret = process.env.CONNECTOR_TOKEN_SECRET;
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    dir = mkdtempSync(join(tmpdir(), "mind-pcloud-"));
    setConnectorDirectory(dir);
    setStorageConnectorDirectory(dir);
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.CONNECTOR_TOKEN_SECRET;
    else process.env.CONNECTOR_TOKEN_SECRET = prevSecret;
  });

  it("keeps StoredConnection encrypted on disk (no plaintext token)", () => {
    storeAccessToken({
      ownerId: "owner-pc",
      connector: "pcloud",
      accessToken: "pcloud-PLAIN-TOKEN-should-not-appear",
      accountLabel: "pcloud-test",
    });
    const path = storageRecordPath("owner-pc", "pcloud");
    assert.equal(existsSync(path), true);
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes("pcloud-PLAIN-TOKEN"), false);
    assert.match(raw, /accessTokenEnc/);
    assert.equal(getAccessToken("owner-pc", "pcloud"), "pcloud-PLAIN-TOKEN-should-not-appear");
  });

  it("resolves MIND_PCLOUD_TOKEN env and encrypted record", async () => {
    const env = { MIND_PCLOUD_TOKEN: "env-pcloud-token" };
    const fromEnv = resolveStorageAccessToken("anyone", "pcloud", env);
    assert.equal(fromEnv.ok, true);
    if (fromEnv.ok) assert.equal(fromEnv.token, "env-pcloud-token");

    storeAccessToken({
      ownerId: "owner-pc2",
      connector: "pcloud",
      accessToken: "record-pcloud-token",
    });
    const fromRecord = await resolveStorageAccessTokenAsync("owner-pc2", "pcloud", { env: {} });
    assert.equal(fromRecord.ok, true);
    if (fromRecord.ok) {
      assert.equal(fromRecord.token, "record-pcloud-token");
      assert.equal(fromRecord.source, "record");
    }
  });

  it("upload succeeds when result===0 and never leaks token in errors", async () => {
    const token = "super-secret-pcloud-access-token-value";
    let sawTokenInUrl = false;
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes(token)) sawTokenInUrl = true;
      if (url.includes("/createfolderifnotexists")) {
        return new Response(JSON.stringify({ result: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/uploadfile")) {
        assert.equal(init?.method, "PUT");
        assert.match(url, /nopartial=1/);
        assert.match(url, /filename=/);
        assert.match(url, /path=/);
        return new Response(
          JSON.stringify({
            result: 0,
            metadata: [{ fileid: 42, name: "x.txt", path: "/AdriansMind/media/x.txt" }],
            fileids: [42],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ result: 1000, error: `bad ${token}` }), { status: 400 });
    };

    const provider = createPcloudProvider(fetchMock, { MIND_PCLOUD_API_HOST: "api.pcloud.com" });
    const uploaded = await provider.upload({
      accessToken: token,
      bytes: new TextEncoder().encode("hi"),
      fileName: "x.txt",
      mimeType: "text/plain",
      folderSegments: ["media"],
    });
    assert.equal(uploaded.remoteId, "42");
    assert.equal(uploaded.service, "pcloud");
    assert.equal(sawTokenInUrl, true); // query param auth is expected; must not appear in thrown errors

    await assert.rejects(
      () =>
        createPcloudProvider(async () => {
          return new Response(JSON.stringify({ result: 2000, error: `denied ${token}` }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }).upload({
          accessToken: token,
          bytes: new Uint8Array([1]),
          fileName: "y.txt",
          mimeType: "text/plain",
          folderSegments: ["media"],
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.equal(msg.includes(token), false);
        assert.match(msg, /result=2000|pCloud/i);
        return true;
      },
    );
  });

  it("failed health/quota errors never include the token", async () => {
    const token = "leak-me-pcloud-token-abcdef";
    const provider = createPcloudProvider(async () => {
      return new Response(JSON.stringify({ result: 1000, error: `nope ${token}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const health = await provider.health(token);
    assert.equal(health.connected, false);
    assert.equal(JSON.stringify(health).includes(token), false);

    await assert.rejects(() => provider.quota(token), (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.equal(msg.includes(token), false);
      return true;
    });
  });

  it("resolvePcloudApiHost defaults and rejects non-pcloud hosts", () => {
    assert.equal(resolvePcloudApiHost({}), "api.pcloud.com");
    assert.equal(resolvePcloudApiHost({ MIND_PCLOUD_API_HOST: "eapi.pcloud.com" }), "eapi.pcloud.com");
    assert.equal(resolvePcloudApiHost({ MIND_PCLOUD_API_HOST: "evil.example.com" }), "api.pcloud.com");
    assert.equal(resolvePcloudApiHost({ MIND_PCLOUD_API_HOST: "evil.pcloud.com" }), "api.pcloud.com");
    assert.equal(resolvePcloudApiHost({ MIND_PCLOUD_API_HOST: "pcloud.com" }), "api.pcloud.com");
    assert.equal(resolvePcloudApiHost({ MIND_PCLOUD_API_HOST: "https://api.pcloud.com/hack" }), "api.pcloud.com");
  });
});
