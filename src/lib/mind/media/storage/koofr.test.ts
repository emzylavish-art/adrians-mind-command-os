import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { storeAccessToken, setConnectorDirectory, getAccessToken } from "../../connectors/store.ts";
import {
  packKoofrBasicToken,
  resolveStorageAccessToken,
  resolveStorageAccessTokenAsync,
  setStorageConnectorDirectory,
  storageRecordPath,
} from "./credentials.ts";
import {
  buildKoofrDavUrl,
  createKoofrProvider,
  KOOFR_DAV_HOST,
  koofrAuthorizationHeader,
} from "./providers/koofr.ts";

const SECRET = "unit-test-koofr-connector-secret";

describe("Koofr storage provider", () => {
  let prevSecret: string | undefined;
  let dir: string;

  beforeEach(() => {
    prevSecret = process.env.CONNECTOR_TOKEN_SECRET;
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    dir = mkdtempSync(join(tmpdir(), "mind-koofr-"));
    setConnectorDirectory(dir);
    setStorageConnectorDirectory(dir);
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.CONNECTOR_TOKEN_SECRET;
    else process.env.CONNECTOR_TOKEN_SECRET = prevSecret;
  });

  it("buildKoofrDavUrl allowlists only app.koofr.net over https", () => {
    const url = buildKoofrDavUrl(["AdriansMind", "media", "x.txt"]);
    assert.match(url, /^https:\/\/app\.koofr\.net\/dav\/Koofr\//);
    assert.equal(new URL(url).hostname, KOOFR_DAV_HOST);
    assert.equal(url.includes(".."), false);
  });

  it("keeps StoredConnection encrypted (packed basic token, no plaintext password)", () => {
    const user = "zackosment1@gmail.com";
    const password = "apppw-PLAIN-should-not-appear";
    const packed = packKoofrBasicToken(user, password);
    storeAccessToken({
      ownerId: "owner-kf",
      connector: "koofr",
      accessToken: packed,
      accountLabel: user,
    });
    const path = storageRecordPath("owner-kf", "koofr");
    assert.equal(existsSync(path), true);
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes(password), false);
    assert.equal(raw.includes(packed), false);
    assert.match(raw, /accessTokenEnc/);
    assert.equal(getAccessToken("owner-kf", "koofr"), packed);
  });

  it("resolves MIND_KOOFR_USER + MIND_KOOFR_APP_PASSWORD into Basic token", () => {
    const env = {
      MIND_KOOFR_USER: "zackosment1@gmail.com",
      MIND_KOOFR_APP_PASSWORD: "sixteencharsapp!",
    };
    const fromEnv = resolveStorageAccessToken("anyone", "koofr", env);
    assert.equal(fromEnv.ok, true);
    if (fromEnv.ok) {
      assert.equal(fromEnv.token, packKoofrBasicToken(env.MIND_KOOFR_USER, env.MIND_KOOFR_APP_PASSWORD));
      assert.equal(fromEnv.source, "env");
    }
    // Password alone is not enough
    const incomplete = resolveStorageAccessToken("anyone", "koofr", {
      MIND_KOOFR_APP_PASSWORD: "sixteencharsapp!",
    });
    assert.equal(incomplete.ok, false);
  });

  it("upload PUTs via WebDAV with redirect:manual and never leaks secrets", async () => {
    const user = "zackosment1@gmail.com";
    const password = "super-secret-koofr-app-password";
    const token = packKoofrBasicToken(user, password);
    const methods: string[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      assert.equal(new URL(url).hostname, "app.koofr.net");
      assert.equal(init?.redirect, "manual");
      const auth = String((init?.headers as Record<string, string>)?.authorization || "");
      assert.equal(auth, koofrAuthorizationHeader(token));
      assert.equal(auth.includes(password), false);
      methods.push(String(init?.method || "GET"));
      if (init?.method === "MKCOL") {
        return new Response(null, { status: 201 });
      }
      if (init?.method === "PUT") {
        assert.match(url, /\/dav\/Koofr\/AdriansMind\//);
        if ((fetchMock as any)._failNext) {
          return new Response(`leak ${password}`, { status: 500 });
        }
        return new Response(null, { status: 201 });
      }
      if (init?.method === "PROPFIND") {
        return new Response("<m/>", { status: 207 });
      }
      return new Response(`leak ${password}`, { status: 500 });
    };

    const provider = createKoofrProvider(fetchMock);
    const uploaded = await provider.upload({
      accessToken: token,
      bytes: new TextEncoder().encode("probe"),
      fileName: "probe.txt",
      mimeType: "text/plain",
      folderSegments: ["media", "oauth-seed"],
    });
    assert.equal(uploaded.service, "koofr");
    assert.equal(uploaded.remoteId.startsWith("/AdriansMind/"), true);
    assert.ok(methods.includes("PUT"));
    assert.ok(methods.includes("MKCOL"));

    const health = await provider.health(token);
    assert.equal(health.ok, true);
    assert.equal(health.connected, true);

    (fetchMock as any)._failNext = true;
    await assert.rejects(
      () =>
        provider.upload({
          accessToken: token,
          bytes: new Uint8Array([1]),
          fileName: "fail.txt",
          mimeType: "text/plain",
          folderSegments: [],
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.equal(msg.includes(password), false);
        assert.equal(msg.includes(token), false);
        return true;
      },
    );
  });

  it("async resolver returns packed token from encrypted record", async () => {
    const user = "zackosment1@gmail.com";
    const packed = packKoofrBasicToken(user, "record-app-password");
    storeAccessToken({
      ownerId: "owner-kf2",
      connector: "koofr",
      accessToken: packed,
      accountLabel: user,
    });
    const result = await resolveStorageAccessTokenAsync("owner-kf2", "koofr", { env: {} });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.token, packed);
      assert.equal(result.source, "record");
    }
  });
});
