import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLOUD_ORIGIN,
  LOCAL_BUILD,
  FULL_PACKAGE,
  decideFullUpdate,
  isFullPackageSpec,
  readCloudManifest,
  PUBLIC_INSTALLER,
  chooseCloud,
  decideUpdate,
  hashesMatch,
  isAllowedDownloadUrl,
  publishedManifest,
  resolveDownloadUrl,
  updateNote,
} from "./desktop-update.ts";

const require = createRequire(import.meta.url);
const cjs = require("../../../desktop/cloud-update.cjs");
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const hash = "a".repeat(64);
const remote = {
  ...publishedManifest,
  build: 2,
  sha256: hash,
  fullPackage: { ...FULL_PACKAGE, sha256: hash },
};

test("a newer full package opens the release with all four verified parts", () => {
  const decision = decideUpdate(1, remote);
  assert.equal(decision.action, "install");
  assert.equal(decision.url, PUBLIC_INSTALLER);
  assert.equal(cjs.decideUpdate(1, remote).action, "install");
});

test("an equal or older cloud build stays on the installed copy", () => {
  assert.equal(decideUpdate(2, { ...remote, build: 2 }).reason, "cloud-current");
  assert.equal(decideUpdate(3, { ...remote, build: 2 }).reason, "cloud-older");
  assert.equal(cjs.decideUpdate(3, { ...remote, build: 2 }).action, "stay");
});

test("a missing or unsigned manifest does not install or load a page", () => {
  assert.equal(decideUpdate(1, null).reason, "cloud-missing");
  assert.equal(decideUpdate(1, { product: "other", build: 9 }).reason, "cloud-missing");
  assert.equal(decideUpdate(1, { ...remote, sha256: "" }).action, "switch");
  assert.equal(decideUpdate(1, { ...remote, size: 0 }).action, "switch");
  assert.equal(decideUpdate(1, { ...remote, sha256: "A".repeat(64) }).action, "switch");
});

test("download hosts are pinned and redirects cannot choose the window", () => {
  assert.equal(isAllowedDownloadUrl(`${CLOUD_ORIGIN}/downloads/AdriansMind-Setup.exe`), true);
  assert.equal(isAllowedDownloadUrl("https://github.com/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup-Full.exe.part00"), true);
  assert.equal(isAllowedDownloadUrl("https://github.com/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup.exe"), false);
  assert.equal(isAllowedDownloadUrl(PUBLIC_INSTALLER), false);
  assert.equal(isAllowedDownloadUrl("https://release-assets.githubusercontent.com/file"), false);
  assert.equal(isAllowedDownloadUrl("https://release-assets.githubusercontent.com/file", 1), true);
  for (const blocked of [
    "http://adrians-mind.vercel.app/downloads/AdriansMind-Setup.exe",
    "https://user:pass@adrians-mind.vercel.app/downloads/AdriansMind-Setup.exe",
    "https://adrians-mind.vercel.app:444/downloads/AdriansMind-Setup.exe",
    "https://preview.example/downloads/AdriansMind-Setup.exe",
    "https://127.0.0.1/downloads/AdriansMind-Setup.exe",
    "https://github.com/emzylavish-art/adrians-mind-command-os/archive/main.zip",
    "file:///tmp/AdriansMind-Setup.exe",
    "https://adrians-mind.vercel.app/api/mind/turn",
  ]) {
    assert.equal(isAllowedDownloadUrl(blocked), false, blocked);
    assert.equal(cjs.isAllowedDownloadUrl(blocked), false, blocked);
  }
  assert.equal(resolveDownloadUrl("/other.exe"), null);
  assert.equal(decideUpdate(1, { ...remote, download: "https://evil.example/AdriansMind-Setup.exe" }).url, PUBLIC_INSTALLER);
});

test("hash rejection is exact and the note does not carry a token", () => {
  assert.equal(hashesMatch(hash, hash), true);
  assert.equal(hashesMatch(hash, `${"b".repeat(63)}a`), false);
  assert.equal(cjs.hashesMatch(hash, `${"b".repeat(63)}a`), false);
  const note = updateNote(LOCAL_BUILD, null, decideUpdate(LOCAL_BUILD, null));
  assert.match(note, new RegExp(CLOUD_ORIGIN));
  assert.equal(/ghp_|github_pat_|Bearer |sk-/.test(note), false);
  assert.equal(publishedManifest.download, PUBLIC_INSTALLER);
  assert.equal(publishedManifest.build, LOCAL_BUILD);
});

test("the launcher pins the same host and does not embed a token", () => {
  const launcher = readFileSync(join(root, "desktop/main.cjs"), "utf8");
  const rules = readFileSync(join(root, "desktop/cloud-update.cjs"), "utf8");
  assert.match(launcher, /cloud-update\.cjs/);
  assert.match(rules, /https:\/\/adrians-mind\.vercel\.app/);
  assert.equal(rules.includes("manus.computer"), false);
  assert.equal(launcher.includes("ghp_"), false);
  assert.equal(rules.includes("github_pat_"), false);
  assert.equal(cjs.LOCAL_BUILD, LOCAL_BUILD);
  assert.equal(cjs.CLOUD_ORIGIN, CLOUD_ORIGIN);
  assert.match(launcher, /process\.platform !== "win32"/);
  assert.match(launcher, /node\.exe/);
  assert.match(launcher, /resourcesPath/);
  assert.equal(launcher.includes("ELECTRON_RUN_AS_NODE"), true);
});

test("retired single-file feeds and incomplete packages cannot install a release part", () => {
  for (const download of ["/downloads/AdriansMind-Setup.exe", FULL_PACKAGE.parts[0].url]) {
    const single = { ...remote, size: 600_000_000, download, fullPackage: undefined };
    assert.equal(decideUpdate(1, single).action, "switch");
    assert.equal(cjs.decideUpdate(1, single).action, "switch");
  }
  for (const parts of [
    FULL_PACKAGE.parts.slice(1),
    [...FULL_PACKAGE.parts].reverse(),
    [FULL_PACKAGE.parts[0], FULL_PACKAGE.parts[0], ...FULL_PACKAGE.parts.slice(2)],
    [{ ...FULL_PACKAGE.parts[0], url: FULL_PACKAGE.parts[1].url }, ...FULL_PACKAGE.parts.slice(1)],
  ]) {
    const pack = { ...FULL_PACKAGE, parts };
    assert.equal(isFullPackageSpec(pack), false);
    assert.equal(cjs.isFullPackageSpec(pack), false);
  }
});

test("cloud feed parsing keeps the complete split-file contract", async () => {
  const read = await readCloudManifest(async () => Response.json(remote));
  assert.equal(decideFullUpdate(1, read).action, "full-install");
  assert.equal(cjs.decideFullUpdate(1, read).action, "full-install");
});
test("the future site download points at the public installer and not a private token", () => {
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  const redirect = vercel.redirects.find((item: { source?: string }) => item.source === "/downloads/AdriansMind-Setup.exe");
  assert.match(redirect.destination, /releases\/tag\/desktop-installer/);
  assert.equal(JSON.stringify(vercel).includes("ghp_"), false);
});

test("a missing live feed can use the public file, and an equal build stays pinned", () => {
  const published = { ...remote, build: 2, download: PUBLIC_INSTALLER };
  assert.equal(chooseCloud(null, published), published);
  assert.equal(cjs.chooseCloud(null, published).build, 2);
  const same = { ...remote, build: 1 };
  assert.equal(chooseCloud(same, published), published);
  assert.equal(chooseCloud(same, { ...same }), same);
  assert.equal(decideUpdate(1, published).action, "install");
  assert.equal(decideUpdate(1, published).url, PUBLIC_INSTALLER);
});
