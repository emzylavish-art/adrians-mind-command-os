import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { chooseCloud, decideUpdate, decideFullUpdate, readCloudCheck, publishedManifest, LOCAL_BUILD, updateNote, isAllowedDownloadUrl, PUBLIC_INSTALLER } from "./desktop-update.ts";
const require = createRequire(import.meta.url);
const cjs = require("../../../desktop/cloud-update.cjs");
const { releaseFixture } = require("../../../scripts/desktop/release-fixture.cjs");
test("TS web check and desktop launcher share exact signed update policy", async () => {
  const fixture = releaseFixture(); const options = { trust: fixture.trust, installedBuild: 9 };
  assert.equal(decideUpdate(9, fixture.manifest, options).action, "install");
  assert.equal(cjs.decideUpdate(9, fixture.manifest, options).action, "install");
  assert.equal(decideFullUpdate(9, fixture.manifest, options).action, "full-install");
  assert.equal(decideUpdate(10, fixture.manifest, options).reason, "current");
  assert.equal(decideUpdate(11, fixture.manifest, options).reason, "older");
  assert.equal(chooseCloud({ ...fixture.manifest, build: 99 }, fixture.manifest, options), fixture.manifest);
  const checked = await readCloudCheck(async () => Response.json(fixture.manifest), options);
  assert.equal(checked.selected?.build, 10); assert.equal(checked.feeds.every(feed => feed.ok), true);
});
test("legacy published hash metadata cannot authorize an installation or silent website switch", () => {
  assert.equal(decideUpdate(0, publishedManifest).action, "stay");
  assert.equal(decideUpdate(0, publishedManifest).reason, "unsigned_legacy");
  assert.equal(decideUpdate(9, null).action, "stay");
  assert.match(updateNote(LOCAL_BUILD, null, decideUpdate(LOCAL_BUILD, null)), /installed executable version is reported only by the desktop app/);
  assert.equal(isAllowedDownloadUrl(PUBLIC_INSTALLER), false);
});
