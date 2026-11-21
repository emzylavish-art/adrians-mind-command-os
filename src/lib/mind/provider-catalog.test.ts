import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankCatalogModels } from "./provider-catalog.ts";

describe("rankCatalogModels", () => {
  it("puts zero-price text models first and keeps the rest", () => {
    const ranked = rankCatalogModels([
      { id: "paid/one", pricing: { prompt: "0.000001", completion: "0.000002" }, architecture: { output_modalities: ["text"] } },
      { id: "free/text", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["text"] } },
      { id: "free/image", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["image"] } },
      "manual/kept",
    ]);
    assert.deepEqual(ranked, ["free/text", "paid/one", "free/image", "manual/kept"]);
  });

  it("does not stop at 120 models", () => {
    const found = Array.from({ length: 130 }, (_, index) => `vendor/model-${index}`);
    const ranked = rankCatalogModels(found);
    assert.equal(ranked.length, 130);
    assert.equal(ranked[129], "vendor/model-129");
  });

  it("keeps an OpenRouter alias that starts with a tilde", () => {
    const ranked = rankCatalogModels(["paid/one", "~openai/gpt-astra-latest"]);
    assert.deepEqual(ranked, ["paid/one", "~openai/gpt-astra-latest"]);
  });
});
