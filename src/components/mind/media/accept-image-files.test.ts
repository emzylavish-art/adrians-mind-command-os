import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyImageFile,
  explainRejectedImageFile,
  filterAcceptableImageFiles,
  formatImageRejectNotice,
} from "./accept-image-files.ts";

function fakeFile(name: string, type: string, size = 12): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe("accept image files", () => {
  it("rejects SVG/HTML disguises and accepts raster names", () => {
    assert.match(explainRejectedImageFile(fakeFile("x.svg", "image/svg+xml")) || "", /SVG/);
    assert.match(explainRejectedImageFile(fakeFile("payload.exe", "image/png")) || "", /suspicious/);
    assert.match(explainRejectedImageFile(fakeFile("page.html", "text/html")) || "", /HTML/);
    assert.match(explainRejectedImageFile(fakeFile("photo.heic", "image/heic")) || "", /HEIC/);
    assert.equal(explainRejectedImageFile(fakeFile("ok.png", "image/png")), null);
    assert.equal(classifyImageFile(fakeFile("ok.jpg", "image/jpeg")).ok, true);
    assert.equal(classifyImageFile(fakeFile("bad.svg", "image/svg+xml")).ok, false);
  });

  it("filters mixed drops with a clear reject notice", () => {
    const { accepted, rejects } = filterAcceptableImageFiles(
      [
        fakeFile("a.png", "image/png"),
        fakeFile("evil.svg", "image/svg+xml"),
        fakeFile("b.webp", "image/webp"),
        fakeFile("note.html", "text/html"),
      ],
      4,
    );
    assert.equal(accepted.length, 2);
    assert.ok(rejects.some((line) => /SVG/.test(line)));
    assert.ok(rejects.some((line) => /HTML/.test(line)));
    const notice = formatImageRejectNotice(rejects, accepted.length);
    assert.match(notice, /Attached 2/);
    assert.match(notice, /Rejected/);
  });

  it("stops at the attach count cap", () => {
    const files = Array.from({ length: 6 }, (_, i) => fakeFile(`n${i}.png`, "image/png"));
    const { accepted, rejects } = filterAcceptableImageFiles(files, 4);
    assert.equal(accepted.length, 4);
    assert.ok(rejects.some((line) => /Only 4/.test(line)));
  });
});
