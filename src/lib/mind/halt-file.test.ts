import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readHaltFile, setHaltDirectory, writeHaltFile } from "./halt-file.ts";

describe("durable stop file", () => {
  it("keeps one owner's stop after a fresh read and does not expose it as another owner's stop", () => {
    setHaltDirectory(mkdtempSync(join(tmpdir(), "mind-halt-")));
    assert.equal(readHaltFile("owner").halted, false);
    writeHaltFile("owner", true);
    assert.equal(readHaltFile("owner").halted, true);
    assert.equal(readHaltFile("owner").ownerId, "owner");
    assert.equal(readHaltFile("other").halted, false);
    writeHaltFile("owner", false);
    assert.equal(readHaltFile("owner").halted, false);
  });
});
