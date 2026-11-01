import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  allCloudConnectionStatuses,
  cloudConnectionStatus,
  hasCloudConnectionRecord,
  readCloudConnectionRecord,
  resolveCloudAccessToken,
  setCloudConnectorDirectory,
} from "./connection.ts";
import { packageCloudFetchForComposer } from "./attach.ts";
import { isDriveImageMime, isDriveTextMime, listGoogleDriveFiles, fetchGoogleDriveFile } from "./drive.ts";
import { listOneDriveFiles, fetchOneDriveFile } from "./onedrive.ts";

describe("cloud connection records", () => {
  it("reports not_connected without a record and connected when a record exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-cloud-"));
    setCloudConnectorDirectory(dir);
    const owner = "owner-a";
    assert.equal(hasCloudConnectionRecord(owner, "google_drive"), false);
    assert.equal(cloudConnectionStatus(owner, "google_drive", {}).state, "not_connected");
    assert.match(cloudConnectionStatus(owner, "google_drive", {}).detail, /ServiceBoard/);

    const hashDir = join(dir, createHash("sha256").update(owner).digest("hex"));
    mkdirSync(hashDir, { recursive: true });
    writeFileSync(
      join(hashDir, "google_drive.json"),
      JSON.stringify({
        connector: "google_drive",
        ownerId: owner,
        accessToken: "ya29.test-token",
        accountLabel: "drive@example.com",
        connectedAt: "2026-11-01T12:00:00+01:00",
      }),
    );
    assert.equal(hasCloudConnectionRecord(owner, "google_drive"), true);
    const status = cloudConnectionStatus(owner, "google_drive", {});
    assert.equal(status.state, "connected");
    assert.equal(status.accountLabel, "drive@example.com");
    assert.equal(readCloudConnectionRecord(owner, "google_drive")?.accessToken, "ya29.test-token");
  });

  it("resolves plaintext tokens and stubs OneDrive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-cloud-"));
    setCloudConnectorDirectory(dir);
    const owner = "owner-b";
    const hashDir = join(dir, createHash("sha256").update(owner).digest("hex"));
    mkdirSync(hashDir, { recursive: true });
    writeFileSync(
      join(hashDir, "google_drive.json"),
      JSON.stringify({
        connector: "google_drive",
        ownerId: owner,
        accessToken: "token-plain",
        connectedAt: "2026-11-01T12:00:00+01:00",
      }),
    );
    const tok = await resolveCloudAccessToken(owner, "google_drive", {});
    assert.equal(tok.ok, true);
    if (tok.ok) assert.equal(tok.token, "token-plain");

    const od = cloudConnectionStatus(owner, "onedrive", {});
    assert.equal(od.state, "unsupported");
    assert.equal(listOneDriveFiles({}).ok, false);
    assert.equal(fetchOneDriveFile({ fileId: "x", name: "a" }).ok, false);

    const all = allCloudConnectionStatuses(owner, {});
    assert.equal(all.length, 2);
  });
});

describe("drive list/fetch helpers", () => {
  it("classifies mime helpers and packages attaches", () => {
    assert.equal(isDriveImageMime("image/png"), true);
    assert.equal(isDriveTextMime("text/plain", "notes.txt"), true);
    const packaged = packageCloudFetchForComposer({
      ok: true,
      name: "shot.png",
      mimeType: "image/png",
      base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      bytes: 3,
      kind: "image",
    });
    assert.equal(packaged.ok, true);
    if (packaged.ok && packaged.kind === "image") {
      assert.match(packaged.image.dataUrl, /^data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==$/);
    }
    const textPack = packageCloudFetchForComposer({
      ok: true,
      name: "a.txt",
      mimeType: "text/plain",
      base64: "YQ==",
      bytes: 1,
      kind: "text",
      text: "hello",
    });
    assert.equal(textPack.ok, true);
    if (textPack.ok && textPack.kind === "text") assert.equal(textPack.staged.text, "hello");
    const mismatch = packageCloudFetchForComposer({
      ok: true,
      kind: "image",
      name: "lie.png",
      mimeType: "image/jpeg",
      base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    } as never);
    // tiny is PNG bytes claimed as jpeg → reject
    assert.equal(mismatch.ok, false);

    const bad = packageCloudFetchForComposer({
      ok: true,
      name: "x.bin",
      mimeType: "application/octet-stream",
      base64: "AA==",
      bytes: 1,
      kind: "unsupported",
    });
    assert.equal(bad.ok, false);
  });

  it("lists and fetches via injected fetch", async () => {
    const listed = await listGoogleDriveFiles({
      token: "t",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ files: [{ id: "1", name: "pic.png", mimeType: "image/png", size: "4" }] }),
        arrayBuffer: async () => new ArrayBuffer(0),
        text: async () => "",
      }),
    });
    assert.equal(listed.ok, true);
    if (listed.ok) {
      assert.equal(listed.files[0]?.id, "1");
      assert.equal(listed.files[0]?.source, "google_drive");
    }

    const png = Uint8Array.from([137, 80, 78, 71]);
    const fetched = await fetchGoogleDriveFile({
      token: "t",
      fileId: "1",
      name: "pic.png",
      mimeType: "image/png",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
        arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
        text: async () => "",
      }),
    });
    assert.equal(fetched.ok, true);
    if (fetched.ok) assert.equal(fetched.kind, "image");
  });
});
