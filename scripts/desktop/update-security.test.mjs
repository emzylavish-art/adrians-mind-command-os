import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import contract from "../../desktop/update-contract.cjs";
import downloader from "../../desktop/update-download.cjs";
import installer from "../../desktop/installer-auth.cjs";
import fixtures from "./release-fixture.cjs";
const { releaseFixture } = fixtures;

test("signed release parts support 1, 4 and 6 chunks and reject reordered/missing/modified bytes metadata", () => {
  for (const count of [1, 4, 6]) {
    const f = releaseFixture(count);
    assert.equal(contract.validateReleaseCandidate(f.manifest, { trust: f.trust, installedBuild: 9 }).ok, true);
    for (const parts of [f.manifest.fullPackage.parts.slice(1), [...f.manifest.fullPackage.parts].reverse(), f.manifest.fullPackage.parts.map((part, index) => index ? part : { ...part, size: part.size + 1 })]) {
      if (count === 1 && parts.length === 1 && parts[0] === f.manifest.fullPackage.parts[0]) continue;
      assert.equal(contract.validateReleaseCandidate(f.resign({ ...f.manifest, fullPackage: { ...f.manifest.fullPackage, parts } }), { trust: f.trust }).ok, false);
    }
    assert.equal(contract.validateReleaseCandidate({ ...f.manifest, revision: "c".repeat(40) }, { trust: f.trust }).code, "invalid_signature");
  }
});
test("independent publisher pins, platform, expiry and downgrade are enforced before selection", () => {
  const f = releaseFixture();
  assert.equal(contract.validateReleaseCandidate(f.manifest).code, "publisher_unconfigured");
  assert.equal(contract.validateReleaseCandidate(f.manifest, { trust: f.trust, platform: "darwin" }).code, "incompatible_platform");
  assert.equal(contract.validateReleaseCandidate(f.manifest, { trust: f.trust, installedBuild: 10 }).code, "current");
  assert.equal(contract.validateReleaseCandidate(f.manifest, { trust: f.trust, installedBuild: 11 }).code, "older");
  assert.equal(contract.validateReleaseCandidate(f.resign({ ...f.manifest, expiresAt: new Date(0).toISOString() }), { trust: f.trust }).code, "expired_manifest");
  const invalidHigher = { ...f.manifest, build: 99 };
  const selected = contract.chooseReleaseCandidates([{ source: "vercel", manifest: invalidHigher }, { source: "github", manifest: f.manifest }], { trust: f.trust, installedBuild: 9 });
  assert.equal(selected.selected.build, 10); assert.equal(selected.checks[0].code, "invalid_signature");
  assert.equal(contract.allowedAssetUrl("https://github.com/other/repo/releases/download/release/AdriansMind-Setup-Full.exe.part00"), false);
  assert.equal(contract.allowedAssetUrl("https://github.com/emzylavish-art/adrians-mind-command-os/releases/download/release/AdriansMind-Setup-Full.exe.part00?token=x"), false);
});
test("feed failures remain distinct and timeouts bound fetches that ignore AbortSignal", async () => {
  const inputs = [
    [async () => { throw new Error("private request failure"); }, "network_error"],
    [async () => new Response("unavailable", { status: 503 }), "http_error"],
    [async () => new Response("<html>", { headers: { "content-type": "text/html" } }), "invalid_content_type"],
    [async () => new Response("{", { headers: { "content-type": "application/json" } }), "invalid_json"],
    [async () => Response.json({ product: "other", build: 3 }), "invalid_manifest"],
    [() => new Promise(() => {}), "timeout"],
  ];
  for (const [fetcher, code] of inputs) {
    const result = await contract.readUpdateFeed(fetcher, "https://fixture.invalid", "github", { timeoutMs: 10 });
    assert.equal(result.code, code); assert.equal(result.source, "github"); assert.doesNotMatch(result.detail, /private request/);
  }
});
test("interrupted full download resumes verified parts without repeating them or installing", async () => {
  const f = releaseFixture(4); const dir = await mkdtemp(path.join(tmpdir(), "native-update-"));
  const calls = []; let fail = true;
  const fetcher = async url => { const index = f.manifest.fullPackage.parts.findIndex(part => part.url === url); calls.push(index); if (index === 2 && fail) throw new Error("synthetic interruption"); return new Response(f.bytes[index], { headers: { "content-length": String(f.bytes[index].length) } }); };
  try {
    await assert.rejects(downloader.downloadRelease(f.manifest, dir, { trust: f.trust, fetch: fetcher, availableBytes: 1e9 }), /interruption/);
    fail = false; const result = await downloader.downloadRelease(f.manifest, dir, { trust: f.trust, fetch: fetcher, availableBytes: 1e9 });
    assert.deepEqual(calls, [0, 1, 2, 2, 3]); assert.equal(result.reusedBytes, f.bytes[0].length + f.bytes[1].length); assert.equal(result.installerSignatureVerified, false); assert.deepEqual(await readFile(result.file), f.joined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("partial resume uses exact range and requires a new decision before restarting its bytes", async () => {
  const f = releaseFixture(1); const dir = await mkdtemp(path.join(tmpdir(), "native-update-")); const part = f.manifest.fullPackage.parts[0];
  try {
    await writeFile(path.join(dir, part.name + ".partial"), f.bytes[0].subarray(0, 4));
    await assert.rejects(downloader.downloadRelease(f.manifest, dir, { trust: f.trust, availableBytes: 1e9, fetch: async () => new Response(f.bytes[0]) }), /Confirm its download restart/);
    let range;
    const result = await downloader.downloadRelease(f.manifest, dir, { trust: f.trust, availableBytes: 1e9, fetch: async (_url, init) => { range = init.headers.range; return new Response(f.bytes[0].subarray(4), { status: 206, headers: { "content-range": `bytes 4-${part.size - 1}/${part.size}` } }); } });
    assert.equal(range, "bytes=4-"); assert.deepEqual(await readFile(result.file), f.joined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("disk limits, wrong bytes and cancellation never produce a verified installer", async () => {
  const f = releaseFixture(1); const dir = await mkdtemp(path.join(tmpdir(), "native-update-")); let calls = 0;
  try {
    await assert.rejects(downloader.downloadRelease(f.manifest, dir, { trust: f.trust, availableBytes: 1, fetch: async () => { calls++; return new Response(f.joined); } }), /free bytes/); assert.equal(calls, 0);
    await assert.rejects(downloader.downloadRelease(f.manifest, dir, { trust: f.trust, availableBytes: 1e9, fetch: async () => new Response(Buffer.alloc(f.joined.length)) }), /hash verification/);
    const stop = new AbortController(); stop.abort();
    await assert.rejects(downloader.downloadRelease(f.manifest, dir, { trust: f.trust, availableBytes: 1e9, signal: stop.signal, fetch: async () => { calls++; return new Response(f.joined); } }), /canceled/); assert.equal(calls, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("hash-matching installer still needs trusted Windows Authenticode identity", async () => {
  const expected = "a".repeat(64); let calls = 0;
  const run = async (_command, args) => { calls++; assert.match(args.at(-1), /Get-AuthenticodeSignature -LiteralPath 'C:\\fixture''s\\installer.exe'/); return { stdout: JSON.stringify({ valid: true, signerSha256: expected }) }; };
  assert.equal((await installer.verifyInstallerPublisher("C:\\fixture's\\installer.exe", expected, { platform: "win32", run })).ok, true);
  assert.equal((await installer.verifyInstallerPublisher("C:\\fixture's\\installer.exe", expected, { platform: "win32", run: async () => ({ stdout: JSON.stringify({ valid: true, signerSha256: "b".repeat(64) }) }) })).ok, false);
  assert.equal((await installer.verifyInstallerPublisher("file", expected, { platform: "linux", run })).ok, false); assert.equal(calls, 1);
});
test("a complete verified cached installer needs no new download or assembly disk reserve", async () => {
  const f = releaseFixture(1); const dir = await mkdtemp(path.join(tmpdir(), "native-update-")); let calls = 0;
  try {
    await writeFile(path.join(dir, f.manifest.fullPackage.finalName), f.joined);
    const result = await downloader.downloadRelease(f.manifest, dir, { trust: f.trust, availableBytes: 0, fetch: async () => { calls++; return new Response(f.joined); } });
    assert.equal(calls, 0); assert.equal(result.downloadedBytes, 0); assert.equal(result.installerSignatureVerified, false);
    assert.match(contract.releasePageUrl(f.manifest.fullPackage), /releases\/tag\/fixture-10$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
