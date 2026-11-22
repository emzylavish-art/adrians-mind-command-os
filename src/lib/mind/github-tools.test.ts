import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runGitHubTool } from "./github-tools.ts";

describe("GitHub tools", () => {
  it("does not pretend a missing bank or headset exists", () => {
    const listed = runGitHubTool("list tools") ?? "";
    assert.match(listed, /bank: not connected/);
    assert.match(listed, /headset: not connected/);
    assert.match(listed, /second-person: not connected/);
    assert.match(listed, /LibreTranslate is not installed/);
  });

  it("refuses translation without LibreTranslate", () => {
    const result = runGitHubTool("translate hello");
    assert.match(result ?? "", /No text was translated/);
  });

  it("runs restic and OpenSCAD when the binaries exist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "adrian-tools-"));
    const backup = runGitHubTool("backup folder", root) ?? "";
    const model = runGitHubTool("make model", root) ?? "";
    if (backup.includes("not installed")) {
      assert.match(backup, /Nothing was backed up/);
    } else {
      assert.match(backup, /restic created/);
      assert.match(backup, /HP EliteBook was not backed up/);
    }
    if (model.includes("not installed")) {
      assert.match(model, /No model was made/);
    } else {
      assert.match(model, /OpenSCAD wrote/);
      assert.match(model, /No manufacturer was contacted/);
    }
  });
});
