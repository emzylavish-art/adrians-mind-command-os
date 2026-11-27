import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createFileRateLimitStore,
  LOCAL_IMAGINE_RATE_LIMIT_PATH,
  resolveImagineRateLimitPath,
} from "./rate-limit-store.ts";

describe("Imagine rate-limit runtime storage", () => {
  it("uses Vercel's writable temporary directory instead of the deployment package", () => {
    assert.equal(
      resolveImagineRateLimitPath({ VERCEL: "1" }, "/runtime-tmp"),
      join("/runtime-tmp", "adrians-mind", "media-imagine-rate-limit.json"),
    );
    assert.equal(resolveImagineRateLimitPath({}, "/runtime-tmp"), LOCAL_IMAGINE_RATE_LIMIT_PATH);
  });

  it("persists and reloads limits from a writable path", () => {
    const directory = mkdtempSync(join(tmpdir(), "imagine-rate-limit-"));
    const file = join(directory, "nested", "limits.json");
    try {
      const first = createFileRateLimitStore(file);
      first.set("owner:session", [10, 20]);
      const second = createFileRateLimitStore(file);
      assert.deepEqual(second.get("owner:session"), [10, 20]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps enforcing limits in memory when the filesystem cannot be written", () => {
    const directory = mkdtempSync(join(tmpdir(), "imagine-rate-limit-fallback-"));
    const blockingFile = join(directory, "not-a-directory");
    writeFileSync(blockingFile, "fixture", "utf8");
    try {
      const store = createFileRateLimitStore(join(blockingFile, "limits.json"));
      assert.doesNotThrow(() => store.set("owner:session", [30, 40]));
      assert.deepEqual(store.get("owner:session"), [30, 40]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
