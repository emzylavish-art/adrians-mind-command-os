import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FORBIDDEN_REFS } from "../../registry.ts";
import {
  acceptAssetUrl,
  ASSET_CACHE_SKEW_MS,
  ASSET_SIGNED_TTL_SECONDS,
  clearAssetUrlCache,
  getAssetUrl,
  getAssetUrls,
  normalizeAssetKey,
  parseAssetKey,
  publicAssetPath,
} from "./asset-url.ts";
import { handleAssetUrl, resetAssetUrlRateLimit } from "./asset-sign.ts";
import { SUPABASE_STORAGE_ORIGIN } from "./credentials.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const SERVICE_KEY = "test-service-role-key";
const NOW = Date.parse("2026-11-01T12:00:00.000Z");
const NOISE = "brand/textures/noise.webp";
const GLASS = "brand/textures/glass.webp";
const HERO = "brand/hero/background.mp4";

function envConfigured(): Record<string, string | undefined> {
  return {
    MIND_SUPABASE_URL: SUPABASE_STORAGE_ORIGIN,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  };
}

type Call = { url: string; method: string; body?: string; authorization: string | null; apikey: string | null };

function storageFetch(present: string[]) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body,
      authorization: headers.get("authorization"),
      apikey: headers.get("apikey"),
    });
    assert.equal(url.includes(SERVICE_KEY), false);
    assert.equal(init?.redirect, "error");
    if (url.includes("/storage/v1/object/list/")) {
      const parsed = JSON.parse(body ?? "{}") as { prefix?: string };
      const prefix = parsed.prefix ?? "";
      const rows = present
        .filter((key) => {
          const slash = key.lastIndexOf("/");
          const folder = slash >= 0 ? key.slice(0, slash) : "";
          return folder === prefix;
        })
        .map((key) => ({
          name: key.slice(key.lastIndexOf("/") + 1),
          id: `id-${key}`,
          metadata: { size: 12 },
        }));
      return Response.json(rows);
    }
    const pathname = new URL(url).pathname;
    if (/\/storage\/v1\/object\/sign\/[^/]+$/.test(pathname)) {
      const parsed = JSON.parse(body ?? "{}") as { paths?: string[]; expiresIn?: number };
      assert.equal(parsed.expiresIn, ASSET_SIGNED_TTL_SECONDS);
      const bucket = pathname.split("/").pop();
      return Response.json(
        (parsed.paths ?? []).map((path) => ({
          path,
          error: null,
          signedURL: `/object/sign/${bucket}/${path}?token=signed-token`,
        })),
      );
    }
    if (url.includes("/storage/v1/object/sign/")) {
      const parsed = JSON.parse(body ?? "{}") as { expiresIn?: number };
      assert.equal(parsed.expiresIn, ASSET_SIGNED_TTL_SECONDS);
      const path = url.split("/storage/v1/object/sign/")[1] ?? "";
      return Response.json({ signedURL: `/object/sign/${path}?token=signed-token` });
    }
    return new Response("unexpected", { status: 500 });
  };
  return { fetchImpl, calls };
}

function request(method: string, url: string, body?: unknown, headers?: Record<string, string>) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

describe("brand asset keys", () => {
  it("allows the brand bucket extensions and rejects traversal", () => {
    for (const extension of ["png", "jpeg", "jpg", "webp", "avif", "svg", "mp4", "webm"]) {
      assert.equal(normalizeAssetKey(`brand/card/texture.${extension}`), `brand/card/texture.${extension}`);
    }
    assert.equal(normalizeAssetKey(NOISE), NOISE);
    assert.equal(normalizeAssetKey(`  ${NOISE}  `), NOISE);
    assert.equal(normalizeAssetKey(`/${NOISE}`), null);
    assert.equal(normalizeAssetKey("../secret.png"), null);
    assert.equal(normalizeAssetKey("brand/../../etc/passwd.png"), null);
    assert.equal(normalizeAssetKey("brand\\textures\\noise.webp"), null);
    assert.equal(normalizeAssetKey("brand/textures/noise.gif"), null);
    assert.equal(normalizeAssetKey("brand/textures/noise"), null);
    assert.equal(normalizeAssetKey(""), null);
    assert.equal(publicAssetPath(NOISE), `/${NOISE}`);
  });
});

describe("brand asset signing", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetAssetUrlRateLimit();
  });

  it("returns a one-hour signed URL for an object in media-brand", async () => {
    const { fetchImpl, calls } = storageFetch([NOISE]);
    const response = await handleAssetUrl(
      request("GET", `https://app.example/api/mind/media/asset-url?key=${encodeURIComponent(NOISE)}`),
      { env: envConfigured(), fetchImpl, now: NOW },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { url: string; expiresAt: string };
    const signed = new URL(body.url);
    assert.equal(signed.origin, SUPABASE_STORAGE_ORIGIN);
    assert.equal(signed.pathname, `/storage/v1/object/sign/media-brand/${NOISE}`);
    assert.equal(signed.searchParams.get("token"), "signed-token");
    assert.equal(body.url.includes(SERVICE_KEY), false);
    assert.equal(Date.parse(body.expiresAt) - NOW, ASSET_SIGNED_TTL_SECONDS * 1000);
    assert.equal(calls.some((call) => call.authorization === `Bearer ${SERVICE_KEY}`), true);
    assert.equal(calls.some((call) => call.apikey === SERVICE_KEY), true);
    assert.equal(calls.some((call) => call.url.includes("/object/sign/media-brand/")), true);
    assert.equal(JSON.stringify(body).includes(SERVICE_KEY), false);
  });

  it("falls back to the public path when the object is missing or storage is not configured", async () => {
    const missing = storageFetch([]);
    const missingResponse = await handleAssetUrl(
      request("GET", `https://app.example/api/mind/media/asset-url?key=${encodeURIComponent(NOISE)}`),
      { env: envConfigured(), fetchImpl: missing.fetchImpl, now: NOW },
    );
    const missingBody = (await missingResponse.json()) as { url: string; expiresAt: string };
    assert.equal(missingBody.url, `/${NOISE}`);
    assert.equal(Date.parse(missingBody.expiresAt) - NOW, 10 * 60 * 1000);
    assert.equal(missing.calls.some((call) => call.url.includes("/object/sign/")), false);

    let fetches = 0;
    const unconfigured = await handleAssetUrl(
      request("GET", `https://app.example/api/mind/media/asset-url?key=${encodeURIComponent(HERO)}`),
      {
        env: {},
        now: NOW,
        fetchImpl: async () => {
          fetches += 1;
          return new Response("no", { status: 500 });
        },
      },
    );
    const body = (await unconfigured.json()) as { url: string };
    assert.equal(fetches, 0);
    assert.equal(body.url, `/${HERO}`);
  });

  it("signs a batch and leaves missing keys on the public path", async () => {
    const { fetchImpl, calls } = storageFetch([NOISE]);
    const response = await handleAssetUrl(request("POST", "https://app.example/api/mind/media/asset-url", { keys: [NOISE, GLASS, NOISE] }), {
      env: envConfigured(),
      fetchImpl,
      now: NOW,
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { urls: Record<string, { url: string; expiresAt: string }> };
    assert.match(body.urls[NOISE]?.url ?? "", /\/storage\/v1\/object\/sign\/media-brand\/brand\/textures\/noise\.webp\?token=signed-token$/);
    assert.equal(body.urls[GLASS]?.url, `/${GLASS}`);
    assert.equal(Object.keys(body.urls).length, 2);
    const lists = calls.filter((call) => call.url.includes("/object/list/"));
    assert.equal(lists.length, 1);
    const sign = calls.find((call) => call.url.includes("/storage/v1/object/sign/media-brand/"));
    assert.ok(sign);
    assert.equal(JSON.parse(sign.body ?? "{}").expiresIn, ASSET_SIGNED_TTL_SECONDS);
    assert.match(sign.url, /noise\.webp$/);
    assert.equal(JSON.stringify(body).includes(SERVICE_KEY), false);
  });

  it("rejects unsafe keys and cross-site requests before calling Supabase", async () => {
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return new Response("no", { status: 500 });
    };
    const traversal = await handleAssetUrl(
      request("GET", "https://app.example/api/mind/media/asset-url?key=..%2Fsecret.png"),
      { env: envConfigured(), fetchImpl, now: NOW },
    );
    assert.equal(traversal.status, 400);
    const gif = await handleAssetUrl(request("POST", "https://app.example/api/mind/media/asset-url", { keys: ["brand/logo.gif"] }), {
      env: envConfigured(),
      fetchImpl,
      now: NOW,
    });
    assert.equal(gif.status, 400);
    const cross = await handleAssetUrl(
      request("POST", "https://app.example/api/mind/media/asset-url", { keys: [NOISE] }, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" }),
      { env: envConfigured(), fetchImpl, now: NOW },
    );
    assert.equal(cross.status, 403);
    assert.equal(fetches, 0);
  });

  it("does not return a signed URL on another host or one that contains the service key", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/object/list/")) {
        return Response.json([{ name: "noise.webp", id: "1" }]);
      }
      return Response.json({
        signedURL: `https://evil.example/storage/v1/object/sign/media-brand/${NOISE}?token=${SERVICE_KEY}`,
      });
    };
    const response = await handleAssetUrl(
      request("GET", `https://app.example/api/mind/media/asset-url?key=${encodeURIComponent(NOISE)}`),
      { env: envConfigured(), fetchImpl, now: NOW },
    );
    const body = (await response.json()) as { url: string };
    assert.equal(body.url, `/${NOISE}`);
    assert.equal(body.url.includes(SERVICE_KEY), false);
  });
});

const PRIVATE_KEYS = {
  "media-images": "media-images/AdriansMind/media/imagine/shot.png",
  "media-video": "media-video/AdriansMind/media/clip.mp4",
  "media-audio": "media-audio/AdriansMind/media/voice.mp3",
  "media-camera": "media-camera/AdriansMind/media/camera/still.webp",
} as const;

function signedIn(): { requireUserId: () => Promise<string> } {
  return { requireUserId: async () => "user-1" };
}

function unsigned(): { requireUserId: () => Promise<string> } {
  return {
    requireUserId: async () => {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    },
  };
}

describe("asset URL session gate", { concurrency: 1 }, () => {
  beforeEach(() => {
    resetAssetUrlRateLimit();
  });

  it("signs media-brand for a signed-out caller and does not ask for a session", async () => {
    let sessionChecks = 0;
    const { fetchImpl } = storageFetch([NOISE]);
    const response = await handleAssetUrl(
      request("GET", `https://app.example/api/mind/media/asset-url?key=${encodeURIComponent(NOISE)}`),
      {
        env: envConfigured(),
        fetchImpl,
        now: NOW,
        requireUserId: async () => {
          sessionChecks += 1;
          throw new Error("session must not be required for media-brand");
        },
      },
    );
    assert.equal(sessionChecks, 0);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { url: string };
    assert.match(body.url, /\/object\/sign\/media-brand\//);
  });

  it("returns 401 for every private bucket on GET and POST when nobody is signed in", async () => {
    for (const key of Object.values(PRIVATE_KEYS)) {
      let fetches = 0;
      const response = await handleAssetUrl(
        request("GET", `https://app.example/api/mind/media/asset-url?key=${encodeURIComponent(key)}`),
        {
          env: envConfigured(),
          now: NOW,
          ...unsigned(),
          fetchImpl: async () => {
            fetches += 1;
            return new Response("no", { status: 500 });
          },
        },
      );
      assert.equal(response.status, 401, key);
      const body = (await response.json()) as { error: string };
      assert.match(body.error, /Sign in is required/);
      assert.equal(fetches, 0, key);
    }

    let batchFetches = 0;
    const batch = await handleAssetUrl(
      request("POST", "https://app.example/api/mind/media/asset-url", { keys: [NOISE, PRIVATE_KEYS["media-camera"]] }),
      {
        env: envConfigured(),
        now: NOW,
        ...unsigned(),
        fetchImpl: async () => {
          batchFetches += 1;
          return new Response("no", { status: 500 });
        },
      },
    );
    assert.equal(batch.status, 401);
    assert.equal(batchFetches, 0);
  });

  it("returns 403 when the session check fails closed", async () => {
    const response = await handleAssetUrl(
      request("POST", "https://app.example/api/mind/media/asset-url", { keys: [PRIVATE_KEYS["media-video"]] }),
      {
        env: envConfigured(),
        now: NOW,
        fetchImpl: async () => new Response("no", { status: 500 }),
        requireUserId: async () => {
          throw new Error("Auth is disabled but DATABASE_URL is set");
        },
      },
    );
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "Forbidden.");
    assert.equal(body.error.includes("DATABASE_URL"), false);
  });

  it("signs private buckets only after the session check succeeds", async () => {
    const present = Object.values(PRIVATE_KEYS).map((key) => parseAssetKey(key)?.objectKey ?? "");
    const { fetchImpl, calls } = storageFetch(present);
    const response = await handleAssetUrl(
      request("POST", "https://app.example/api/mind/media/asset-url", { keys: Object.values(PRIVATE_KEYS) }),
      { env: envConfigured(), fetchImpl, now: NOW, ...signedIn() },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { urls: Record<string, { url: string }> };
    for (const [bucket, key] of Object.entries(PRIVATE_KEYS)) {
      const url = body.urls[key]?.url ?? "";
      assert.match(url, new RegExp(`/storage/v1/object/sign/${bucket}/`));
      assert.equal(url.includes(SERVICE_KEY), false);
      assert.equal(acceptAssetUrl(key, url), url);
    }
    const signedBuckets = calls
      .filter((call) => call.url.includes("/object/sign/"))
      .map((call) => call.url);
    assert.equal(signedBuckets.some((url) => url.includes("/media-images/")), true);
    assert.equal(signedBuckets.some((url) => url.includes("/media-brand/")), false);
  });

  it("uses requireUserId for a private key when no test double is installed", async () => {
    let fetches = 0;
    const response = await handleAssetUrl(
      request("GET", `https://app.example/api/mind/media/asset-url?key=${encodeURIComponent(PRIVATE_KEYS["media-audio"])}`),
      {
        env: envConfigured(),
        now: NOW,
        fetchImpl: async () => {
          fetches += 1;
          return new Response("no", { status: 500 });
        },
      },
    );
    assert.ok(response.status === 401 || response.status === 403);
    assert.equal(fetches, 0);
    const source = readFileSync(join(here, "asset-sign.ts"), "utf8");
    assert.match(source, /requireUserId/);
    assert.match(source, /verify\.server/);
  });
});

describe("brand asset client", { concurrency: 1 }, () => {
  beforeEach(() => {
    clearAssetUrlCache();
  });

  it("caches a signed URL until five minutes before expiry and falls back otherwise", async () => {
    const cache = new Map<string, { url: string; expiresAtMs: number }>();
    let calls = 0;
    const signed = `${SUPABASE_STORAGE_ORIGIN}/storage/v1/object/sign/media-brand/${NOISE}?token=signed-token`;
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1;
      assert.match(String(input), /\/api\/mind\/media\/asset-url\?key=/);
      return Response.json({ url: signed, expiresAt: new Date(NOW + ASSET_SIGNED_TTL_SECONDS * 1000).toISOString() });
    };
    const first = await getAssetUrl(NOISE, { now: NOW, fetchImpl, cache });
    const second = await getAssetUrl(NOISE, { now: NOW + 60_000, fetchImpl, cache });
    assert.equal(first, signed);
    assert.equal(second, signed);
    assert.equal(calls, 1);

    const expiredAt = NOW + ASSET_SIGNED_TTL_SECONDS * 1000 - ASSET_CACHE_SKEW_MS;
    const third = await getAssetUrl(NOISE, { now: expiredAt, fetchImpl, cache });
    assert.equal(third, signed);
    assert.equal(calls, 2);
  });

  it("does not cache a URL that is already inside the five-minute window", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return Response.json({
        url: `/${NOISE}`,
        expiresAt: new Date(NOW + ASSET_CACHE_SKEW_MS - 1).toISOString(),
      });
    };
    const cache = new Map<string, { url: string; expiresAtMs: number }>();
    await getAssetUrl(NOISE, { now: NOW, fetchImpl, cache });
    await getAssetUrl(NOISE, { now: NOW + 1, fetchImpl, cache });
    assert.equal(calls, 2);
    assert.equal(cache.size, 0);
  });

  it("loads a batch with POST and falls back when the request fails", async () => {
    let body = "";
    const signed = `${SUPABASE_STORAGE_ORIGIN}/storage/v1/object/sign/media-brand/${GLASS}?token=signed-token`;
    const urls = await getAssetUrls([GLASS, HERO], {
      now: NOW,
      cache: new Map(),
      fetchImpl: async (_input, init) => {
        assert.equal(init?.method, "POST");
        body = String(init?.body ?? "");
        return Response.json({
          urls: {
            [GLASS]: { url: signed, expiresAt: new Date(NOW + 3_600_000).toISOString() },
            [HERO]: { url: `/${HERO}`, expiresAt: new Date(NOW + 600_000).toISOString() },
          },
        });
      },
    });
    assert.deepEqual(JSON.parse(body).keys, [GLASS, HERO]);
    assert.equal(urls[GLASS], signed);
    assert.equal(urls[HERO], `/${HERO}`);

    const failed = await getAssetUrls([NOISE], {
      now: NOW,
      cache: new Map(),
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    assert.equal(failed[NOISE], `/${NOISE}`);
    assert.equal(acceptAssetUrl(NOISE, "https://evil.example/storage/v1/object/sign/media-brand/x.webp"), `/${NOISE}`);
  });

  it("rejects an invalid key before fetching", async () => {
    let calls = 0;
    await assert.rejects(
      () => getAssetUrl("../secret.png", { fetchImpl: async () => {
        calls += 1;
        return new Response("no");
      } }),
      /Invalid asset key/,
    );
    assert.equal(calls, 0);
  });
});

describe("brand asset boundaries", () => {
  it("keeps the service key out of the client module and does not name a forbidden project", () => {
    const client = readFileSync(join(here, "asset-url.ts"), "utf8");
    assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(client, /SUPABASE_SECRET_KEY/);
    assert.doesNotMatch(client, /process\.env/);
    assert.doesNotMatch(client, /node:/);
    assert.doesNotMatch(client, /asset-sign/);
    assert.match(client, /media-brand/);
    const signer = readFileSync(join(here, "asset-sign.ts"), "utf8");
    assert.doesNotMatch(signer, /method:\s*["']DELETE["']/);
    assert.match(readFileSync(join(here, "providers/supabase.ts"), "utf8"), /media-brand/);
    const barrel = readFileSync(join(here, "../index.ts"), "utf8");
    assert.doesNotMatch(barrel, /asset-url/);
    for (const file of ["asset-url.ts", "asset-sign.ts", "WIRING.md"]) {
      const src = readFileSync(join(here, file), "utf8");
      for (const ref of FORBIDDEN_REFS) assert.equal(src.includes(ref), false, file);
    }
  });
});
