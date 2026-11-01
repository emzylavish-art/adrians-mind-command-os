import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkImagineRateLimit,
  dimensionsLookLikeBomb,
  isSafeCloudFileId,
  isSafeImageSrc,
  isSafeRemoteImageUrl,
  mapImagineHttpError,
  resetImagineRateLimitForTests,
  sanitizeImaginePrompt,
  sanitizeMediaLabel,
  sniffImageMimeFromBase64,
} from "./harden.ts";
import { isImageDataUrl, normalizeImageDataUrl, parseImageDataUrl } from "./data-url.ts";
import { sanitizeAttachments, historyTextForImages } from "./pack.ts";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TINY_PNG = `data:image/png;base64,${TINY_PNG_B64}`;

describe("adversarial: unsafe image src / XSS vectors", () => {
  it("rejects javascript: and data:text/html srcs", () => {
    assert.equal(isSafeImageSrc("javascript:alert(1)"), false);
    assert.equal(isSafeImageSrc("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="), false);
    assert.equal(isSafeImageSrc("vbscript:msgbox"), false);
    assert.equal(isSafeImageSrc(TINY_PNG), true);
    assert.equal(isSafeImageSrc("https://cdn.example/a.png"), true);
    assert.equal(isSafeImageSrc("http://cdn.example/a.png"), true);
    assert.equal(isSafeImageSrc("file:///etc/passwd"), false);
  });

  it("rejects SVG and non-image data URLs in the image data-URL parser", () => {
    const svg = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    assert.equal(isImageDataUrl(svg), false);
    assert.equal(normalizeImageDataUrl(svg), null);
    assert.equal(isImageDataUrl("data:text/html;base64,YQ=="), false);
    assert.equal(sanitizeAttachments([{ dataUrl: svg, name: "x.svg" }]).length, 0);
  });

  it("sanitizes malicious filenames and alt labels", () => {
    assert.equal(sanitizeMediaLabel('<img src=x onerror=alert(1)>.png'), "img src=x onerror=alert(1).png");
    assert.equal(sanitizeMediaLabel("a\u0000b"), "ab");
    const packed = sanitizeAttachments([{ dataUrl: TINY_PNG, name: '<script>x</script>.png' }]);
    assert.equal(packed[0]?.name?.includes("<"), false);
    assert.match(historyTextForImages("hi", packed), /Attached:/);
    assert.equal(historyTextForImages("hi", packed).includes("<script>"), false);
  });
});

describe("adversarial: polyglot / empty / magic mismatch", () => {
  it("rejects empty and non-image base64 that claims to be png", () => {
    assert.equal(parseImageDataUrl("data:image/png;base64,").ok, false);
    const textAsPng = "data:image/png;base64," + Buffer.from("not-an-image").toString("base64");
    const sniffed = sniffImageMimeFromBase64(Buffer.from("not-an-image").toString("base64"));
    assert.equal(sniffed, null);
    // After harden wiring, sanitizeAttachments should drop magic-mismatched payloads.
    assert.equal(sanitizeAttachments([{ dataUrl: textAsPng }]).length, 0);
  });

  it("sniffs real PNG magic", () => {
    assert.equal(sniffImageMimeFromBase64(TINY_PNG_B64), "image/png");
  });

  it("flags decompression-bomb dimensions", () => {
    assert.equal(dimensionsLookLikeBomb(30000, 30000), true);
    assert.equal(dimensionsLookLikeBomb(64, 64), false);
    assert.equal(dimensionsLookLikeBomb(0, 10), true);
  });
});

describe("adversarial: SSRF and cloud file id traversal", () => {
  it("blocks private and metadata hosts for remote image downloads", () => {
    assert.equal(isSafeRemoteImageUrl("http://169.254.169.254/latest/meta-data/"), false);
    assert.equal(isSafeRemoteImageUrl("https://127.0.0.1/a.png"), false);
    assert.equal(isSafeRemoteImageUrl("https://localhost/a.png"), false);
    assert.equal(isSafeRemoteImageUrl("https://10.0.0.5/a.png"), false);
    assert.equal(isSafeRemoteImageUrl("https://192.168.1.1/a.png"), false);
    assert.equal(isSafeRemoteImageUrl("https://cdn.example/a.png"), true);
    assert.equal(isSafeRemoteImageUrl("file:///etc/passwd"), false);
  });

  it("rejects path traversal and URL-like cloud file ids", () => {
    assert.equal(isSafeCloudFileId("../etc/passwd"), false);
    assert.equal(isSafeCloudFileId("..\\windows"), false);
    assert.equal(isSafeCloudFileId("https://evil"), false);
    assert.equal(isSafeCloudFileId("1abcXYZ_-"), true);
    assert.equal(isSafeCloudFileId(""), false);
  });
});

describe("adversarial: prompts and honest Imagine errors", () => {
  it("handles Unicode/RTL and rejects null bytes / overlong prompts", () => {
    assert.equal(sanitizeImaginePrompt("مرحبا 🌍").ok, true);
    const nulled = sanitizeImaginePrompt("a\u0000b");
    assert.equal(nulled.ok, true);
    if (nulled.ok) assert.equal(nulled.prompt.includes("\u0000"), false);
    assert.equal(sanitizeImaginePrompt("x".repeat(5000)).ok, false);
    assert.equal(sanitizeImaginePrompt("   ").ok, false);
  });

  it("maps rate-limit and moderation statuses honestly", () => {
    assert.match(mapImagineHttpError(429, "slow down"), /rate-limited/i);
    assert.match(mapImagineHttpError(400, "content moderation policy"), /moderation/i);
    assert.match(mapImagineHttpError(503, ""), /failed/i);
  });
});

describe("adversarial: rate-limit helper surface", () => {
  it("trips after the window max per user", () => {
    resetImagineRateLimitForTests();
    for (let i = 0; i < 8; i++) {
      assert.equal(checkImagineRateLimit("user-a").ok, true);
    }
    const blocked = checkImagineRateLimit("user-a");
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.error, /rate-limited/i);
    assert.equal(checkImagineRateLimit("user-b").ok, true);
    resetImagineRateLimitForTests();
  });
});
