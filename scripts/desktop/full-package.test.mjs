import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { stageFullInstaller } from "../publish-desktop-update.mjs";

test("staging splits and verifies bytes in order without a release upload", async t => {
  const dir = await mkdtemp(join(tmpdir(), "full-package-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const hash = x => createHash("sha256").update(x).digest("hex");
  const chunks = ["one", "two", "three", "four"];
  const body = chunks.join("");
  const finalName = "AdriansMind-Setup-Full.exe";
  const pack = { finalName, size: body.length, sha256: hash(body),
    parts: chunks.map((chunk, i) => ({ name: finalName + ".part0" + i, size: chunk.length, sha256: hash(chunk) })),
  };
  const source = join(dir, finalName);
  await writeFile(source, body);
  await stageFullInstaller(source, pack, dir);
  const staged = await Promise.all(pack.parts.map(part => readFile(join(dir, part.name), "utf8")));
  assert.deepEqual(staged, chunks);
  assert.equal(await readFile(join(dir, finalName + ".sha256"), "utf8"), pack.sha256 + "  " + finalName + "\n");
  for (const part of pack.parts) await rm(join(dir, part.name));
  await writeFile(source, "X" + body.slice(1));
  await assert.rejects(stageFullInstaller(source, pack, dir), /checksum/);
});

test("incomplete engine resources cannot be packaged as the full Windows build", async t => {
  const dir = await mkdtemp(join(tmpdir(), "missing-full-package-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { default: hook } = await import("../../desktop/check-windows-resources.cjs");
  await assert.rejects(hook({ electronPlatformName: "win32", appOutDir: dir }), /model weights/);
  await hook({ electronPlatformName: "linux", appOutDir: dir });
});
