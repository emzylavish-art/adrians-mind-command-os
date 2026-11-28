import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const endpoint = readFileSync(new URL("./imagine-http.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../../../components/mind/command-app.tsx", import.meta.url), "utf8");

describe("image generation receipt contract", () => {
  it("returns the selected provider and allowlisted model on success and failure", () => {
    assert.match(endpoint, /ok: false, error, provider: "xai", model/);
    assert.match(endpoint, /ok: true,\s+provider: "xai",\s+model: result\.reportedModel/);
  });

  it("stores reported provider and model on failed and successful chat messages", () => {
    assert.match(app, /rememberImagineFailure\([\s\S]*?\{ provider: payload\.provider, model: payload\.model \}/);
    assert.match(app, /provider: receipt\?\.provider\?\.trim\(\) \|\| undefined/);
    assert.match(app, /const provider = payload\.provider\?\.trim\(\) \|\| "xai"/);
  });
});
