import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { redactSecrets, appendStorageAudit, setStorageAuditPath, readAuditRaw } from "./audit.ts";
import { setStorageAccountsConfigPath } from "./config.ts";
import { setStorageConnectorDirectory } from "./credentials.ts";
import { bumpLedgerUsed, setStorageLedgerPath, withLedgerLock, readLedgerUsed } from "./ledger.ts";
import { storeMedia, nearCap, storageStatusForOwner } from "./rotation.ts";
import {
  createGoogleDriveProvider,
  createDropboxProvider,
  createOneDriveProvider,
  createPcloudProvider,
  createBoxProvider,
  createKoofrProvider,
  GOOGLE_DRIVE_FORBIDDEN_OPS,
  DROPBOX_FORBIDDEN_OPS,
  ONEDRIVE_FORBIDDEN_OPS,
  BOX_FORBIDDEN_OPS,
  KOOFR_FORBIDDEN_OPS,
} from "./providers/index.ts";
import type { StorageProvider, StorageService } from "./types.ts";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function tinyPng(): Uint8Array {
  // 1x1 PNG
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}

function writeConfig(dir: string, accounts: unknown[]) {
  const path = join(dir, "accounts.json");
  writeFileSync(
    path,
    JSON.stringify({ version: 1, switchThreshold: 0.9, accounts }),
    "utf8",
  );
  setStorageAccountsConfigPath(path);
  return path;
}

function mockProviders(opts: {
  quotas: Partial<Record<StorageService, { used: number; total: number }>>;
  failUpload?: StorageService[];
  uploads?: { service: StorageService; id: string }[];
}): Record<StorageService, StorageProvider> {
  const uploaded: StorageService[] = [];
  const make = (service: StorageService): StorageProvider => ({
    service,
    async health(token) {
      if (!token) return { ok: true, connected: false, detail: "not connected" };
      return { ok: true, connected: true, detail: "ok" };
    },
    async quota() {
      const q = opts.quotas[service] ?? { used: 0, total: 1_000_000 };
      return { usedBytes: q.used, totalBytes: q.total, source: "live" };
    },
    async upload(input) {
      if (opts.failUpload?.includes(service)) throw new Error("forced fail");
      uploaded.push(service);
      opts.uploads?.push({ service, id: `${service}-id` });
      return {
        remoteId: `${service}-id`,
        remotePath: `/AdriansMind/media-test/${input.fileName}`,
        bytes: input.bytes.byteLength,
        service,
        accountEmail: "",
      };
    },
  });
  return {
    google_drive: make("google_drive"),
    dropbox: make("dropbox"),
    onedrive: make("onedrive"),
    pcloud: make("pcloud"),
    box: make("box"),
    koofr: make("koofr"),
  };
}

describe("storage rotation policy", () => {
  it("switches at 90% when used + fileSize exceeds cap × 0.9", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-rot-"));
    const audit = join(dir, "audit.md");
    const ledger = join(dir, "ledger.json");
    setStorageAuditPath(audit);
    setStorageLedgerPath(ledger);
    setStorageConnectorDirectory(join(dir, "connectors"));

    // Cap 1000; Drive used 910 → 910+50 > 900 → skip; Dropbox used 0 → take it.
    writeConfig(dir, [
      { service: "google_drive", accountEmail: "d@example.com", capBytes: 1000, order: 1, enabled: true },
      { service: "dropbox", accountEmail: "x@example.com", capBytes: 1000, order: 2, enabled: true },
      { service: "onedrive", accountEmail: "o@example.com", capBytes: 1000, order: 3, enabled: true },
    ]);

    const uploads: { service: StorageService; id: string }[] = [];
    const providers = mockProviders({
      quotas: {
        google_drive: { used: 910, total: 1000 },
        dropbox: { used: 0, total: 1000 },
        onedrive: { used: 0, total: 1000 },
      },
      uploads,
    });

    const bytes = new Uint8Array(50);
    const result = await storeMedia(
      { ownerId: "u1", bytes, fileName: "shot.png", mimeType: "image/png", folderSegments: ["media-test"] },
      {
        providers,
        env: {
          MIND_GOOGLE_DRIVE_TOKEN: "tok-drive",
          MIND_DROPBOX_TOKEN: "tok-dropbox",
          MIND_ONEDRIVE_TOKEN: "tok-onedrive",
        },
        auditPath: audit,
        ledgerPath: ledger,
        configPath: join(dir, "accounts.json"),
      },
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.service, "dropbox");
      assert.equal(result.switchedFrom, "google_drive");
    }
    assert.equal(nearCap(910, 50, 1000, 0.9), true);
    assert.equal(nearCap(0, 50, 1000, 0.9), false);
    const log = readAuditRaw(audit);
    assert.match(log, /switched from google_drive/);
    assert.doesNotMatch(log, /tok-drive|tok-dropbox/);
  });

  it("fails honestly with storage_full when every connected account is near cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-full-"));
    const audit = join(dir, "audit.md");
    const ledger = join(dir, "ledger.json");
    writeConfig(dir, [
      { service: "google_drive", accountEmail: "d@example.com", capBytes: 1000, order: 1, enabled: true },
      { service: "dropbox", accountEmail: "x@example.com", capBytes: 1000, order: 2, enabled: true },
      { service: "onedrive", accountEmail: "o@example.com", capBytes: 1000, order: 3, enabled: true },
    ]);
    const providers = mockProviders({
      quotas: {
        google_drive: { used: 950, total: 1000 },
        dropbox: { used: 950, total: 1000 },
        onedrive: { used: 950, total: 1000 },
      },
    });
    const result = await storeMedia(
      { ownerId: "u1", bytes: new Uint8Array(100), fileName: "big.bin" },
      {
        providers,
        env: {
          MIND_GOOGLE_DRIVE_TOKEN: "t1",
          MIND_DROPBOX_TOKEN: "t2",
          MIND_ONEDRIVE_TOKEN: "t3",
        },
        auditPath: audit,
        ledgerPath: ledger,
        configPath: join(dir, "accounts.json"),
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "storage_full");
      assert.match(result.error, /full/i);
      assert.match(result.error, /Nothing was deleted/i);
    }
  });

  it("skips a disconnected account and uses the next connected one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-skip-"));
    const audit = join(dir, "audit.md");
    const ledger = join(dir, "ledger.json");
    writeConfig(dir, [
      { service: "google_drive", accountEmail: "d@example.com", capBytes: 10_000, order: 1, enabled: true },
      { service: "dropbox", accountEmail: "x@example.com", capBytes: 10_000, order: 2, enabled: true },
      { service: "onedrive", accountEmail: "o@example.com", capBytes: 10_000, order: 3, enabled: true },
    ]);
    const uploads: { service: StorageService; id: string }[] = [];
    const providers = mockProviders({
      quotas: {
        google_drive: { used: 0, total: 10_000 },
        dropbox: { used: 0, total: 10_000 },
        onedrive: { used: 0, total: 10_000 },
      },
      uploads,
    });
    // Only Dropbox connected
    const result = await storeMedia(
      { ownerId: "u1", bytes: tinyPng(), fileName: "t.png", mimeType: "image/png" },
      {
        providers,
        env: { MIND_DROPBOX_TOKEN: "only-dropbox" },
        auditPath: audit,
        ledgerPath: ledger,
        configPath: join(dir, "accounts.json"),
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.service, "dropbox");
  });

  it("never-delete guarantee: adapter sources contain no delete API calls", () => {
    const files = [
      pathJoin(here, "providers/google-drive.ts"),
      pathJoin(here, "providers/dropbox.ts"),
      pathJoin(here, "providers/onedrive.ts"),
      pathJoin(here, "providers/pcloud.ts"),
      pathJoin(here, "providers/box.ts"),
      pathJoin(here, "providers/koofr.ts"),
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // Ignore comments and the FORBIDDEN_OPS documentation lists (they name APIs we must never call).
      const code = src
        .split("\n")
        .filter((l) => {
          const t = l.trim();
          if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("*/")) return false;
          if (/FORBIDDEN_OPS/.test(t)) return false;
          if (/^["'].*(delete|trash)/i.test(t)) return false;
          return true;
        })
        .join("\n");
      assert.doesNotMatch(code, /files\.delete\(|\.emptyTrash\(|permanently_delete\(|files\/delete(_v2)?\b/i);
      assert.doesNotMatch(code, /method:\s*["']DELETE["']/i);
    }
    assert.ok(GOOGLE_DRIVE_FORBIDDEN_OPS.length > 0);
    assert.ok(DROPBOX_FORBIDDEN_OPS.length > 0);
    assert.ok(ONEDRIVE_FORBIDDEN_OPS.length > 0);
    assert.ok(BOX_FORBIDDEN_OPS.length > 0);
    assert.ok(KOOFR_FORBIDDEN_OPS.length > 0);
  });

  it("ledger concurrency: parallel bumps do not lose updates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-led-"));
    const ledger = join(dir, "ledger.json");
    setStorageLedgerPath(ledger);
    await Promise.all(
      Array.from({ length: 20 }, () => bumpLedgerUsed("google_drive", "d@example.com", 10, ledger)),
    );
    assert.equal(readLedgerUsed("google_drive", "d@example.com", ledger), 200);
    // withLedgerLock exclusivity smoke
    const order: number[] = [];
    await Promise.all([
      withLedgerLock(async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 30));
        order.push(2);
      }, { lockPath: join(dir, "x.lock") }),
      (async () => {
        await new Promise((r) => setTimeout(r, 5));
        await withLedgerLock(() => {
          order.push(3);
        }, { lockPath: join(dir, "x.lock") });
      })(),
    ]);
    assert.deepEqual(order, [1, 2, 3]);
  });

  it("log redaction strips bearer tokens and common secret shapes", () => {
    const dirty =
      "Bearer ya29.a0AfH6SMC-secret upload sl.B12345token eyJhbGciOiJIUzI1NiJ9.abc.def access_token: 'leak'";
    const clean = redactSecrets(dirty);
    assert.doesNotMatch(clean, /ya29/);
    assert.doesNotMatch(clean, /sl\.B12345/);
    assert.doesNotMatch(clean, /eyJhbGci/);
    assert.doesNotMatch(clean, /leak/);
    assert.match(clean, /REDACTED/);

    const dir = mkdtempSync(join(tmpdir(), "mind-aud-"));
    const audit = join(dir, "a.md");
    appendStorageAudit(
      {
        service: "google_drive",
        accountEmail: "d@example.com",
        fileName: "f.png",
        bytes: 1,
        remotePathOrId: "Bearer ya29.should-not-appear",
        usedBytes: 1,
        capBytes: 100,
      },
      audit,
    );
    const raw = readAuditRaw(audit);
    assert.doesNotMatch(raw, /ya29\.should-not-appear/);
    assert.match(raw, /REDACTED/);
  });

  it("provider factories build without throwing", () => {
    assert.equal(createGoogleDriveProvider().service, "google_drive");
    assert.equal(createDropboxProvider().service, "dropbox");
    assert.equal(createOneDriveProvider().service, "onedrive");
    assert.equal(createPcloudProvider().service, "pcloud");
    assert.equal(createBoxProvider().service, "box");
    assert.equal(createKoofrProvider().service, "koofr");
  });

  it("path traversal in filenames is sanitized before upload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-trav-"));
    writeConfig(dir, [
      { service: "dropbox", accountEmail: "x@example.com", capBytes: 10_000, order: 1, enabled: true },
    ]);
    let seenName = "";
    const providers = mockProviders({
      quotas: { dropbox: { used: 0, total: 10_000 } },
    });
    providers.dropbox = {
      ...providers.dropbox,
      async upload(input) {
        seenName = input.fileName;
        return {
          remoteId: "id",
          remotePath: `/AdriansMind/media/${input.fileName}`,
          bytes: input.bytes.byteLength,
          service: "dropbox",
          accountEmail: "",
        };
      },
    };
    const result = await storeMedia(
      {
        ownerId: "u1",
        bytes: tinyPng(),
        fileName: "../../etc/passwd\0.png",
      },
      {
        providers,
        env: { MIND_DROPBOX_TOKEN: "t" },
        auditPath: join(dir, "a.md"),
        ledgerPath: join(dir, "l.json"),
        configPath: join(dir, "accounts.json"),
      },
    );
    assert.equal(result.ok, true);
    assert.doesNotMatch(seenName, /\.\./);
    assert.doesNotMatch(seenName, /\0/);
  });
});

describe("storage never-delete source inventory", () => {
  it("storage/ tree has no delete helpers exported for remote media", () => {
    const root = here;
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) out.push(...walk(p));
        else if (name.name.endsWith(".ts") && !name.name.endsWith(".test.ts")) out.push(p);
      }
      return out;
    };
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      // Allow comments mentioning "never delete" / "Nothing was deleted"
      const code = src
        .split("\n")
        .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
        .join("\n");
      assert.doesNotMatch(code, /files\.delete\(|permanently_delete\(|emptyTrash\(/);
    }
    assert.equal(existsSync(pathJoin(here, "providers/google-drive.ts")), true);
  });
});

describe("connection record resolution", () => {
  it("reads plaintext tokens from mind-connectors records", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-conn-"));
    const connectors = join(dir, "connectors");
    setStorageConnectorDirectory(connectors);
    const owner = "owner-z";
    const hashDir = join(connectors, createHash("sha256").update(owner).digest("hex"));
    mkdirSync(hashDir, { recursive: true });
    writeFileSync(
      join(hashDir, "google_drive.json"),
      JSON.stringify({
        connector: "google_drive",
        ownerId: owner,
        accessToken: "record-token",
        accountLabel: "drive@example.com",
        connectedAt: "2026-11-01T12:00:00+01:00",
      }),
    );
    writeConfig(dir, [
      { service: "google_drive", accountEmail: "drive@example.com", capBytes: 10_000, order: 1, enabled: true },
    ]);
    const providers = mockProviders({ quotas: { google_drive: { used: 0, total: 10_000 } } });
    const result = await storeMedia(
      { ownerId: owner, bytes: tinyPng(), fileName: "r.png" },
      {
        providers,
        env: {},
        auditPath: join(dir, "a.md"),
        ledgerPath: join(dir, "l.json"),
        configPath: join(dir, "accounts.json"),
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.service, "google_drive");
  });
});


describe("storageStatusForOwner live-health honesty", () => {
  it("does not count a lane as connected when live health refuses the token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-status-"));
    writeConfig(dir, [
      { service: "google_drive", accountEmail: "drive@example.com", capBytes: 10_000, order: 1, enabled: true },
    ]);
    const providers = mockProviders({ quotas: { google_drive: { used: 0, total: 10_000 } } });
    providers.google_drive.health = async () => ({
      ok: true,
      connected: false,
      detail: "Google Drive refused the token. Reconnect on ServiceBoard.",
    });
    const rows = await storageStatusForOwner("owner-z", {
      providers,
      env: { MIND_GOOGLE_DRIVE_TOKEN: "stale-token" },
      configPath: join(dir, "accounts.json"),
      ledgerPath: join(dir, "l.json"),
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.connected, false);
    assert.equal(rows[0]!.statusKind, "needs-reconnect");
    assert.match(rows[0]!.detail, /refused the token/i);
  });

  it("counts connected only after live health succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-status-"));
    writeConfig(dir, [
      { service: "dropbox", accountEmail: "db@example.com", capBytes: 10_000, order: 1, enabled: true },
    ]);
    const providers = mockProviders({ quotas: { dropbox: { used: 1, total: 10_000 } } });
    providers.dropbox.health = async () => ({ ok: true, connected: true, detail: "Dropbox reachable." });
    const rows = await storageStatusForOwner("owner-z", {
      providers,
      env: { MIND_DROPBOX_TOKEN: "good" },
      configPath: join(dir, "accounts.json"),
      ledgerPath: join(dir, "l.json"),
    });
    assert.equal(rows[0]!.connected, true);
    assert.equal(rows[0]!.statusKind, "connected");
  });

  it("marks unverified when live health throws (decrypt-only is not connected)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-status-"));
    writeConfig(dir, [
      { service: "box", accountEmail: "box@example.com", capBytes: 10_000, order: 1, enabled: true },
    ]);
    const providers = mockProviders({ quotas: { box: { used: 0, total: 10_000 } } });
    providers.box.health = async () => {
      throw new Error("network down");
    };
    const rows = await storageStatusForOwner("owner-z", {
      providers,
      env: { MIND_BOX_TOKEN: "maybe" },
      configPath: join(dir, "accounts.json"),
      ledgerPath: join(dir, "l.json"),
    });
    assert.equal(rows[0]!.connected, false);
    assert.equal(rows[0]!.statusKind, "unverified");
    assert.match(rows[0]!.detail, /not live-verified/i);
  });
});
