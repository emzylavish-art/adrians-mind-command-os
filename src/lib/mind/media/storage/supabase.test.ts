import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FORBIDDEN_REFS } from "../../registry.ts";
import { readAuditRaw } from "./audit.ts";
import { defaultStorageAccountsFile, orderedEnabledAccounts } from "./config.ts";
import {
  ENV_KEYS,
  resolveStorageAccessToken,
  resolveSupabaseStorageOrigin,
  setStorageConnectorDirectory,
  SUPABASE_STORAGE_ORIGIN,
} from "./credentials.ts";
import { storageStatusForOwner, storeMedia } from "./rotation.ts";
import { bucketForUpload, createSupabaseProvider } from "./providers/supabase.ts";
import {
  SUPABASE_MAX_FILE_BYTES,
  SUPABASE_QUOTA_BYTES,
  type StorageProvider,
  type StorageService,
} from "./types.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const SERVICE_KEY = "test-service-role-key";
const FALLBACK_KEY = "test-secret-key-fallback";

function projectEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    MIND_SUPABASE_URL: SUPABASE_STORAGE_ORIGIN,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    ...extra,
  };
}

function writeAccounts(path: string, accounts: unknown[]) {
  writeFileSync(path, JSON.stringify({ version: 1, switchThreshold: 0.9, accounts }), "utf8");
}

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "mind-supabase-"));
  setStorageConnectorDirectory(join(dir, "connectors"));
  return {
    dir,
    audit: join(dir, "audit.md"),
    ledger: join(dir, "ledger.json"),
    config: join(dir, "accounts.json"),
  };
}

function mockProvider(
  service: StorageService,
  quota = { used: 0, total: SUPABASE_QUOTA_BYTES },
  onUpload?: () => void,
): StorageProvider {
  return {
    service,
    async health(token) {
      if (!token) return { ok: true, connected: false, detail: "not connected" };
      return { ok: true, connected: true, detail: "ok" };
    },
    async quota() {
      return { usedBytes: quota.used, totalBytes: quota.total, source: "live" as const };
    },
    async upload(input) {
      onUpload?.();
      return {
        remoteId: `${service}-id`,
        remotePath: `/AdriansMind/${input.fileName}`,
        bytes: input.bytes.byteLength,
        service,
        accountEmail: "",
      };
    },
  };
}

function providers(partial: Partial<Record<StorageService, StorageProvider>>): Record<StorageService, StorageProvider> {
  const idle = (service: StorageService): StorageProvider => mockProvider(service);
  return {
    supabase: partial.supabase ?? idle("supabase"),
    google_drive: partial.google_drive ?? idle("google_drive"),
    dropbox: partial.dropbox ?? idle("dropbox"),
    onedrive: partial.onedrive ?? idle("onedrive"),
    pcloud: partial.pcloud ?? idle("pcloud"),
  };
}

describe("supabase storage provider", { concurrency: 1 }, () => {
  it("routes media kinds onto the private buckets", () => {
    const cases: [{ mediaKind?: string; mimeType?: string; folderSegments?: string[] }, string][] = [
      [{ mimeType: "image/png", folderSegments: ["media", "imagine"] }, "media-images"],
      [{ mediaKind: "image" }, "media-images"],
      [{ mediaKind: "imagine", mimeType: "application/octet-stream" }, "media-images"],
      [{ folderSegments: ["media", "camera"], mimeType: "image/jpeg" }, "media-camera"],
      [{ folderSegments: ["camera"], mimeType: "video/mp4" }, "media-camera"],
      [{ mediaKind: "camera", mimeType: "video/mp4" }, "media-camera"],
      [{ mediaKind: "video", folderSegments: ["camera"] }, "media-video"],
      [{ mimeType: "video/mp4", folderSegments: ["media"] }, "media-video"],
      [{ folderSegments: ["video"] }, "media-video"],
      [{ mimeType: "audio/mpeg" }, "media-audio"],
      [{ folderSegments: ["audio"], mimeType: "image/png" }, "media-audio"],
      [{ mediaKind: "audio" }, "media-audio"],
      [{ mimeType: "application/pdf", folderSegments: ["media", "attachments"] }, "media-images"],
      [{}, "media-images"],
      [{ mediaKind: "unknown" }, "media-images"],
    ];
    for (const [input, bucket] of cases) {
      assert.equal(bucketForUpload(input), bucket, JSON.stringify(input));
    }
  });

  it("uploads to the media project with the service key and without upsert", async () => {
    const calls: { url: string; method: string; redirect?: RequestRedirect; upsert: string | null; auth: string | null; apikey: string | null }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        redirect: init?.redirect,
        upsert: headers.get("x-upsert"),
        auth: headers.get("authorization"),
        apikey: headers.get("apikey"),
      });
      return Response.json({ Id: "obj-123", Key: "media-images/AdriansMind/media/imagine/shot.png" });
    };
    const provider = createSupabaseProvider(fetchImpl, projectEnv());
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const uploaded = await provider.upload({
      accessToken: SERVICE_KEY,
      bytes,
      fileName: "shot.png",
      mimeType: "image/png",
      folderSegments: ["media", "imagine"],
    });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.equal(call.method, "POST");
    assert.equal(call.redirect, "error");
    assert.equal(new URL(call.url).origin, SUPABASE_STORAGE_ORIGIN);
    assert.match(call.url, /\/storage\/v1\/object\/media-images\/AdriansMind\/media\/imagine\/shot\.png$/);
    assert.equal(call.auth, `Bearer ${SERVICE_KEY}`);
    assert.equal(call.apikey, SERVICE_KEY);
    assert.equal(call.upsert, "false");
    assert.equal(call.url.includes(SERVICE_KEY), false);
    assert.equal(uploaded.service, "supabase");
    assert.equal(uploaded.remoteId, "obj-123");
    assert.equal(uploaded.remotePath, "media-images/AdriansMind/media/imagine/shot.png");
    assert.equal(uploaded.bytes, 4);
  });

  it("retries once under a new name when the object already exists and never removes it", async () => {
    const methods: string[] = [];
    const urls: string[] = [];
    let uploads = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      methods.push(init?.method ?? "GET");
      if (!url.includes("/object/list/") && url.includes("/storage/v1/object/")) {
        uploads += 1;
        urls.push(url);
        if (uploads === 1) {
          return new Response(JSON.stringify({ message: "The resource already exists", statusCode: "409" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json({ Id: "obj-retry" });
      }
      return new Response("unexpected", { status: 500 });
    };
    const provider = createSupabaseProvider(fetchImpl, projectEnv());
    const uploaded = await provider.upload({
      accessToken: SERVICE_KEY,
      bytes: Uint8Array.from([9]),
      fileName: "clip.mp4",
      mimeType: "video/mp4",
      folderSegments: ["media"],
    });
    assert.equal(uploads, 2);
    assert.equal(methods.includes("DELETE"), false);
    assert.match(urls[0] ?? "", /\/media-video\/AdriansMind\/media\/clip\.mp4$/);
    assert.match(urls[1] ?? "", /\/media-video\/AdriansMind\/media\/clip-[a-f0-9]+\.mp4$/);
    assert.equal(uploaded.remoteId, "obj-retry");
    assert.match(uploaded.remotePath, /^media-video\/AdriansMind\/media\/clip-[a-f0-9]+\.mp4$/);
  });

  it("sums live usage across buckets against the 1 GiB quota", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/storage/v1/bucket")) {
        return Response.json([
          { name: "media-images", id: "media-images", public: false },
          { name: "media-video", id: "media-video", public: false },
          { name: "media-audio", id: "media-audio", public: false },
          { name: "media-camera", id: "media-camera", public: false },
        ]);
      }
      const bucket = decodeURIComponent(url.split("/storage/v1/object/list/")[1] ?? "");
      const body = JSON.parse(String(init?.body ?? "{}")) as { prefix?: string; offset?: number };
      if (bucket === "media-images" && body.prefix === "") {
        return Response.json([
          { name: "shot.png", id: "obj-1", metadata: { size: 1000 } },
          { name: "nested", id: null, metadata: null },
        ]);
      }
      if (bucket === "media-images" && body.prefix === "nested") {
        return Response.json([{ name: "more.png", id: "obj-2", metadata: { size: 500 } }]);
      }
      if (bucket === "media-video" && body.prefix === "") {
        return Response.json([{ name: "clip.mp4", id: "obj-3", metadata: { size: 2000 } }]);
      }
      return Response.json([]);
    };
    const provider = createSupabaseProvider(fetchImpl, projectEnv(), { listPageSize: 100 });
    const quota = await provider.quota(SERVICE_KEY);
    assert.equal(quota.source, "live");
    assert.equal(quota.usedBytes, 3500);
    assert.equal(quota.totalBytes, SUPABASE_QUOTA_BYTES);
    assert.equal(quota.totalBytes, 1024 * 1024 * 1024);

    const ws = workspace();
    writeAccounts(ws.config, [
      {
        service: "supabase",
        accountEmail: "media@xarxhdsnprpnosimehon.supabase.co",
        capBytes: SUPABASE_QUOTA_BYTES,
        order: 1,
        enabled: true,
      },
    ]);
    const status = await storageStatusForOwner("owner-1", {
      providers: providers({ supabase: provider }),
      env: projectEnv(),
      configPath: ws.config,
      ledgerPath: ws.ledger,
      auditPath: ws.audit,
    });
    assert.equal(status.length, 1);
    assert.equal(status[0]?.service, "supabase");
    assert.equal(status[0]?.connected, true);
    assert.equal(status[0]?.usedBytes, 3500);
    assert.equal(status[0]?.capBytes, SUPABASE_QUOTA_BYTES);
    assert.equal(status[0]?.remainingBytes, SUPABASE_QUOTA_BYTES - 3500);
    assert.equal(status[0]?.quotaSource, "live");
    assert.equal(status[0]?.nearCap, false);
    assert.equal(JSON.stringify(status).includes(SERVICE_KEY), false);
  });

  it("pages the list API until a short page", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/storage/v1/bucket")) {
        return Response.json([{ name: "media-images", id: "media-images" }]);
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { offset?: number };
      if (body.offset === 0) return Response.json([{ name: "a.png", id: "1", metadata: { size: 10 } }]);
      if (body.offset === 1) return Response.json([{ name: "b.png", id: "2", metadata: { size: 15 } }]);
      return Response.json([]);
    };
    const quota = await createSupabaseProvider(fetchImpl, projectEnv(), { listPageSize: 1 }).quota(SERVICE_KEY);
    assert.equal(quota.usedBytes, 25);
    assert.equal(quota.totalBytes, SUPABASE_QUOTA_BYTES);
  });

  it("reports a refused key without echoing it", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("no", { status: 401 });
    };
    const health = await createSupabaseProvider(fetchImpl, projectEnv()).health(SERVICE_KEY);
    assert.equal(calls, 1);
    assert.equal(health.connected, false);
    assert.match(health.detail, /refused/i);
    assert.equal(JSON.stringify(health).includes(SERVICE_KEY), false);
  });

  it("does not call the API when the URL is not the media project", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("no", { status: 200 });
    };
    const health = await createSupabaseProvider(fetchImpl, {
      MIND_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    }).health(SERVICE_KEY);
    assert.equal(calls, 0);
    assert.equal(health.connected, false);
    assert.equal(resolveSupabaseStorageOrigin({ MIND_SUPABASE_URL: "http://xarxhdsnprpnosimehon.supabase.co" }), null);
    assert.equal(
      resolveSupabaseStorageOrigin({
        MIND_SUPABASE_URL: "https://user:pass@xarxhdsnprpnosimehon.supabase.co",
      }),
      null,
    );
    assert.equal(
      resolveSupabaseStorageOrigin({
        MIND_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_URL: SUPABASE_STORAGE_ORIGIN,
      }),
      null,
    );
    assert.equal(resolveSupabaseStorageOrigin({ SUPABASE_URL: `${SUPABASE_STORAGE_ORIGIN}/storage/v1` }), SUPABASE_STORAGE_ORIGIN);
  });
});

describe("supabase credentials", { concurrency: 1 }, () => {
  it("reads the service key and URL from env, with the documented fallbacks", () => {
    assert.equal(ENV_KEYS.supabase, "SUPABASE_SERVICE_ROLE_KEY");
    const primary = resolveStorageAccessToken("owner", "supabase", projectEnv({ SUPABASE_SECRET_KEY: FALLBACK_KEY }));
    assert.equal(primary.ok, true);
    if (primary.ok) assert.equal(primary.token, SERVICE_KEY);

    const fallback = resolveStorageAccessToken("owner", "supabase", {
      SUPABASE_URL: SUPABASE_STORAGE_ORIGIN,
      SUPABASE_SECRET_KEY: FALLBACK_KEY,
    });
    assert.equal(fallback.ok, true);
    if (fallback.ok) {
      assert.equal(fallback.token, FALLBACK_KEY);
      assert.equal(fallback.source, "env");
    }

    const missingUrl = resolveStorageAccessToken("owner", "supabase", { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
    assert.equal(missingUrl.ok, false);
  });

  it("ignores connector records for the service key", () => {
    const ws = workspace();
    const owner = "owner-disk";
    const dir = join(ws.dir, "connectors", createHash("sha256").update(owner).digest("hex"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "supabase.json"),
      JSON.stringify({ connector: "supabase", ownerId: owner, accessToken: "from-disk-should-not-be-used" }),
    );
    const fromDisk = resolveStorageAccessToken(owner, "supabase", {});
    assert.equal(fromDisk.ok, false);
    const fromEnv = resolveStorageAccessToken(owner, "supabase", projectEnv());
    assert.equal(fromEnv.ok, true);
    if (fromEnv.ok) assert.equal(fromEnv.token, SERVICE_KEY);
  });

  it("refuses forbidden project refs without embedding them in storage sources", () => {
    for (const ref of FORBIDDEN_REFS) {
      assert.equal(resolveSupabaseStorageOrigin({ MIND_SUPABASE_URL: `https://${ref}.supabase.co` }), null);
      assert.equal(resolveSupabaseStorageOrigin({ SUPABASE_URL: `https://${ref}.supabase.co/rest/v1` }), null);
    }
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, name.name);
        if (name.isDirectory()) out.push(...walk(path));
        else if (/\.(ts|md|json)$/.test(name.name) && !name.name.endsWith(".test.ts")) out.push(path);
      }
      return out;
    };
    for (const file of walk(here)) {
      const src = readFileSync(file, "utf8");
      for (const ref of FORBIDDEN_REFS) {
        assert.equal(src.includes(ref), false, file);
      }
    }
  });
});

describe("supabase rotation", { concurrency: 1 }, () => {
  it("is the default first account and the example config matches", () => {
    const defaults = orderedEnabledAccounts(defaultStorageAccountsFile());
    assert.equal(defaults[0]?.service, "supabase");
    assert.equal(defaults[0]?.capBytes, SUPABASE_QUOTA_BYTES);
    assert.deepEqual(
      defaults.map((account) => account.service),
      ["supabase", "google_drive", "dropbox", "onedrive"],
    );
    const example = JSON.parse(readFileSync(join(here, "media-storage-accounts.example.json"), "utf8")) as {
      accounts: { service: string; order: number; capBytes: number }[];
    };
    assert.equal(example.accounts[0]?.service, "supabase");
    assert.equal(example.accounts[0]?.order, 1);
    assert.equal(example.accounts[0]?.capBytes, SUPABASE_QUOTA_BYTES);
    assert.deepEqual(
      example.accounts.map((account) => account.order),
      [1, 2, 3, 4],
    );
  });

  it("uploads to supabase first when it is configured and under the cap", async () => {
    const ws = workspace();
    writeAccounts(ws.config, [
      {
        service: "supabase",
        accountEmail: "media@xarxhdsnprpnosimehon.supabase.co",
        capBytes: SUPABASE_QUOTA_BYTES,
        order: 1,
        enabled: true,
      },
      { service: "google_drive", accountEmail: "d@example.com", capBytes: 10_000, order: 2, enabled: true },
    ]);
    let driveUploads = 0;
    const result = await storeMedia(
      { ownerId: "owner-1", bytes: Uint8Array.from([1, 2, 3]), fileName: "shot.png", mimeType: "image/png" },
      {
        providers: providers({
          supabase: mockProvider("supabase", { used: 0, total: SUPABASE_QUOTA_BYTES }),
          google_drive: mockProvider("google_drive", { used: 0, total: 10_000 }, () => {
            driveUploads += 1;
          }),
        }),
        env: projectEnv({ MIND_GOOGLE_DRIVE_TOKEN: "drive-token" }),
        auditPath: ws.audit,
        ledgerPath: ws.ledger,
        configPath: ws.config,
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.service, "supabase");
      assert.equal(result.switchedFrom, undefined);
      assert.equal(result.capBytes, SUPABASE_QUOTA_BYTES);
    }
    assert.equal(driveUploads, 0);
    const log = readAuditRaw(ws.audit);
    assert.equal(log.includes(SERVICE_KEY), false);
    assert.equal(log.includes("drive-token"), false);
  });

  it("switches off supabase at 90% of the 1 GiB quota", async () => {
    const ws = workspace();
    const cap = 1000;
    writeAccounts(ws.config, [
      { service: "supabase", accountEmail: "media@xarxhdsnprpnosimehon.supabase.co", capBytes: cap, order: 1, enabled: true },
      { service: "google_drive", accountEmail: "d@example.com", capBytes: cap, order: 2, enabled: true },
    ]);
    const result = await storeMedia(
      { ownerId: "owner-1", bytes: new Uint8Array(100), fileName: "wide.png", mimeType: "image/png" },
      {
        providers: providers({
          supabase: mockProvider("supabase", { used: 850, total: cap }),
          google_drive: mockProvider("google_drive", { used: 0, total: cap }),
        }),
        env: projectEnv({ MIND_GOOGLE_DRIVE_TOKEN: "drive-token" }),
        auditPath: ws.audit,
        ledgerPath: ws.ledger,
        configPath: ws.config,
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.service, "google_drive");
      assert.equal(result.switchedFrom, "supabase");
    }
    const log = readAuditRaw(ws.audit);
    assert.match(log, /switched from supabase \(near cap\)/);
    assert.match(log, /Nothing was deleted|near cap/);
    assert.equal(log.includes(SERVICE_KEY), false);
  });

  it("skips supabase for files over 50 MiB and stores them on the next provider", async () => {
    const ws = workspace();
    writeAccounts(ws.config, [
      {
        service: "supabase",
        accountEmail: "media@xarxhdsnprpnosimehon.supabase.co",
        capBytes: SUPABASE_QUOTA_BYTES,
        order: 1,
        enabled: true,
      },
      { service: "google_drive", accountEmail: "d@example.com", capBytes: SUPABASE_QUOTA_BYTES, order: 2, enabled: true },
    ]);
    let fetches = 0;
    const fetchImpl: typeof fetch = async () => {
      fetches += 1;
      return new Response("supabase should not be called", { status: 500 });
    };
    let driveBytes = 0;
    const bytes = new Uint8Array(SUPABASE_MAX_FILE_BYTES + 1);
    const result = await storeMedia(
      { ownerId: "owner-1", bytes, fileName: "long.mp4", mimeType: "video/mp4", folderSegments: ["media", "video"] },
      {
        providers: providers({
          supabase: createSupabaseProvider(fetchImpl, projectEnv()),
          google_drive: mockProvider("google_drive", { used: 0, total: SUPABASE_QUOTA_BYTES }, () => {
            driveBytes = bytes.byteLength;
          }),
        }),
        env: projectEnv({ MIND_GOOGLE_DRIVE_TOKEN: "drive-token" }),
        auditPath: ws.audit,
        ledgerPath: ws.ledger,
        configPath: ws.config,
      },
    );
    assert.equal(fetches, 0);
    assert.equal(driveBytes, SUPABASE_MAX_FILE_BYTES + 1);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.service, "google_drive");
      assert.equal(result.switchedFrom, "supabase");
    }
    const log = readAuditRaw(ws.audit);
    assert.match(log, /skipped supabase \(file exceeds 52428800 byte per-file limit\)/);
    assert.equal(log.includes(SERVICE_KEY), false);
    assert.equal(log.includes("drive-token"), false);
  });

  it("does not delete anything when supabase is the only account and the file is over 50 MiB", async () => {
    const ws = workspace();
    writeAccounts(ws.config, [
      {
        service: "supabase",
        accountEmail: "media@xarxhdsnprpnosimehon.supabase.co",
        capBytes: SUPABASE_QUOTA_BYTES,
        order: 1,
        enabled: true,
      },
    ]);
    let fetches = 0;
    const result = await storeMedia(
      { ownerId: "owner-1", bytes: new Uint8Array(SUPABASE_MAX_FILE_BYTES + 1), fileName: "too-big.bin" },
      {
        providers: providers({
          supabase: createSupabaseProvider(async () => {
            fetches += 1;
            return new Response("no", { status: 500 });
          }, projectEnv()),
        }),
        env: projectEnv(),
        auditPath: ws.audit,
        ledgerPath: ws.ledger,
        configPath: ws.config,
      },
    );
    assert.equal(fetches, 0);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "storage_full");
      assert.match(result.error, /per-file limit/i);
      assert.match(result.error, /Nothing was deleted/i);
    }
    const log = readAuditRaw(ws.audit);
    assert.match(log, /nothing was deleted/i);
    assert.equal(log.includes(SERVICE_KEY), false);
  });
});

describe("supabase client boundary", { concurrency: 1 }, () => {
  it("is not re-exported from the client media barrel and does not read Vite env", () => {
    const client = readFileSync(join(here, "../index.ts"), "utf8");
    assert.doesNotMatch(client, /storage/);
    assert.doesNotMatch(client, /supabase/i);
    const source = readFileSync(join(here, "providers/supabase.ts"), "utf8");
    assert.doesNotMatch(source, /import\.meta\.env/);
    assert.doesNotMatch(source, /VITE_/);
    assert.doesNotMatch(source, /method:\s*["']DELETE["']/);
    assert.doesNotMatch(source, /x-upsert["']?\s*[:=]\s*["']true["']/);
    const serverIndex = readFileSync(join(here, "index.ts"), "utf8");
    assert.match(serverIndex, /server-only|Do NOT re-export from src\/lib\/mind\/media\/index\.ts/);
  });
});
