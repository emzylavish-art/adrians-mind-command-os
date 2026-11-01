import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeHopReach, remoteLooksLikeMindOs } from "./landing-status.ts";

describe("landing-status", () => {
  it("accepts the Mind OS GitHub remote", () => {
    assert.equal(remoteLooksLikeMindOs("https://github.com/emzylavish-art/adrians-mind-command-os.git"), true);
    assert.equal(remoteLooksLikeMindOs("https://github.com/other/repo.git"), false);
  });

  it("flags unreached main hop as not merged", () => {
    const r = computeHopReach({
      tipSha: "aaa",
      dashboard3dSha: "bbb",
      previewSha: "ccc",
      mainSha: "ddd",
      tipIsAncestorOfDashboard: true,
      tipIsAncestorOfPreview: false,
      tipIsAncestorOfMain: false,
    });
    assert.equal(r.mergedIntoDashboard3d, true);
    assert.equal(r.mergedIntoPreviewIntegration, false);
    assert.equal(r.mergedIntoMain, false);
    assert.match(r.hops.find((h) => h.hop === "main")!.note, /not merged to main/i);
  });
});
