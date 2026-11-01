import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeFile } from "./files-read.ts";

describe("file reading", () => {
  it("counts real CSV rows and does not invent a PDF extraction", () => {
    const csv = describeFile("boats.csv", "name\nLake\nDock\n");
    assert.equal(csv.analyzed, true);
    assert.match(csv.summary, /3 text rows/);
    const pdf = describeFile("plan.pdf", "%PDF-1.7");
    assert.equal(pdf.analyzed, false);
    const extracted = describeFile("plan.pdf", "Lake house");
    assert.equal(extracted.analyzed, true);
    assert.match(extracted.summary, /extracted/);
    const image = describeFile("dock.jpg", "");
    assert.equal(image.analyzed, false);
    assert.match(image.summary, /chat vision/);
  });

  it("reads a JSON object and refuses broken JSON", () => {
    assert.match(describeFile("a.json", "{\"name\":\"Lake\"}").summary, /1 keys/);
    assert.equal(describeFile("a.json", "{").analyzed, false);
  });
});
