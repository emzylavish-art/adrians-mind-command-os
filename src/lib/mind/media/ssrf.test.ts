import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isUnsafeResolvedAddress,
  parseIpv4Literal,
  resolveAndPinUrl,
} from "./ssrf.ts";
import { generateImagineImages } from "./imagine.ts";

describe("adversarial: DNS-rebinding / IP literal SSRF", () => {
  it("flags private and decimal/hex/octal IPv4 forms", () => {
    assert.deepEqual(parseIpv4Literal("127.0.0.1"), [127, 0, 0, 1]);
    assert.ok(isUnsafeResolvedAddress("127.0.0.1"));
    assert.ok(isUnsafeResolvedAddress("169.254.169.254"));
    assert.ok(isUnsafeResolvedAddress("10.0.0.5"));
    assert.ok(isUnsafeResolvedAddress("192.168.1.1"));
    assert.ok(isUnsafeResolvedAddress("::1"));
    assert.ok(isUnsafeResolvedAddress("::ffff:127.0.0.1"));
    // 2130706433 == 127.0.0.1
    assert.deepEqual(parseIpv4Literal("2130706433"), [127, 0, 0, 1]);
    assert.ok(isUnsafeResolvedAddress("2130706433"));
    assert.equal(isUnsafeResolvedAddress("8.8.8.8"), false);
  });

  it("refuses when the fake resolver returns a private IP (rebinding harness)", async () => {
    const pinned = await resolveAndPinUrl("https://cdn.example/a.png", async () => ["169.254.169.254"]);
    assert.equal(pinned.ok, false);
    if (!pinned.ok) assert.match(pinned.error, /private/i);
  });

  it("pins a public IP when the fake resolver is clean", async () => {
    const pinned = await resolveAndPinUrl("https://cdn.example/a.png", async () => ["8.8.8.8"]);
    assert.equal(pinned.ok, true);
    if (pinned.ok) assert.equal(pinned.pinnedAddress, "8.8.8.8");
  });

  it("blocks Imagine URL download when lookup returns loopback", async () => {
    const result = await generateImagineImages(
      { prompt: "ssrf", n: 1, responseFormat: "url" },
      {
        apiKey: "test-key",
        lookup: async () => ["127.0.0.1"],
        fetchImpl: async () =>
          new Response(JSON.stringify({ data: [{ url: "https://evil.example/a.png" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /private|refus|unsafe|resolve/i);
  });

  it("validates every dual-stack answer and pins a public IPv4 when present", async () => {
    const pinned = await resolveAndPinUrl("https://cdn.example/a.png", async () => ["2001:db8::1", "8.8.8.8"]);
    assert.equal(pinned.ok, true);
    if (pinned.ok) assert.equal(pinned.pinnedAddress, "8.8.8.8");
  });

  it("refuses mixed public+private answers (rebinding-shaped DNS)", async () => {
    const pinned = await resolveAndPinUrl("https://cdn.example/a.png", async () => ["8.8.8.8", "169.254.169.254"]);
    assert.equal(pinned.ok, false);
  });
});
