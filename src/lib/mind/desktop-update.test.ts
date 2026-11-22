import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLOUD_ORIGIN,
  LOCAL_BUILD,
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
  product: "adrians-mind",
  version: "0.9.0",
  build: 2,
  download: "/downloads/AdriansMind-Setup.exe",
  sha256: hash,
  size: 110238126,
};

test("a newer pinned build with a matching hash can install", () => {
  const decision = decideUpdate(1, remote);
  assert.equal(decision.action, "install");
  assert.equal(decision.url, `${CLOUD_ORIGIN}/downloads/AdriansMind-Setup.exe`);
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
  assert.equal(isAllowedDownloadUrl("https://github.com/emzylavish-art/adrians-mind-command-os/releases/download/desktop-installer/AdriansMind-Setup.exe"), true);
  assert.equal(isAllowedDownloadUrl(PUBLIC_INSTALLER), true);
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
  assert.equal(decideUpdate(1, { ...remote, download: "https://evil.example/AdriansMind-Setup.exe" }).action, "switch");
  assert.equal(decideUpdate(1, remote).switchUrl, `${CLOUD_ORIGIN}/`);
});

test("hash rejection is exact and the note does not carry a token", () => {
  assert.equal(hashesMatch(hash, hash), true);
  assert.equal(hashesMatch(hash, `${"b".repeat(63)}a`), false);
  assert.equal(cjs.hashesMatch(hash, `${"b".repeat(63)}a`), false);
  const note = updateNote(LOCAL_BUILD, null, decideUpdate(LOCAL_BUILD, null));
  assert.match(note, new RegExp(CLOUD_ORIGIN));
  assert.equal(/ghp_|github_pat_|Bearer |sk-/.test(note), false);
  assert.equal(publishedManifest.download, "/downloads/AdriansMind-Setup.exe");
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
});

test("the future site download points at the public installer and not a private token", () => {
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  const redirect = vercel.redirects.find((item: { source?: string }) => item.source === "/downloads/AdriansMind-Setup.exe");
  assert.equal(redirect.destination, PUBLIC_INSTALLER);
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
