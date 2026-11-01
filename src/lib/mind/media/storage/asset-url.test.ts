import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAssetUrl, getAssetUrls } from "./asset-url.ts";

describe("asset-url shim (Fleet contract)", () => {
  it("getAssetUrl falls back to /<key>", async () => {
    assert.equal(await getAssetUrl("brand/logo-mark.webp"), "/brand/logo-mark.webp");
    assert.equal(await getAssetUrl("/art/x.webp"), "/art/x.webp");
  });

  it("getAssetUrls maps many keys", async () => {
    const urls = await getAssetUrls(["a.webp", "b/c.png"]);
    assert.equal(urls["a.webp"], "/a.webp");
    assert.equal(urls["b/c.png"], "/b/c.png");
  });
});
