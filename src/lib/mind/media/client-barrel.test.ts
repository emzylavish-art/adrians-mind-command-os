import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

describe("client media barrel", () => {
  it("does not re-export Node-only modules", () => {
    const source = readFileSync(join(dir, "index.ts"), "utf8");
    const exportLines = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("export "));
    const joined = exportLines.join("\n");
    assert.doesNotMatch(joined, /xai-key/);
    assert.doesNotMatch(joined, /imagine\.ts/);
    assert.doesNotMatch(joined, /["']\.\/imagine["']/);
    assert.doesNotMatch(joined, /cloud\/connection/);
    assert.doesNotMatch(joined, /node:/);
    assert.match(joined, /imagine-shared/);
  });
});
