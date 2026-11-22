import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runAdrianPc } from "./adrian-pc.server.ts";

describe("Adrian PC", () => {
  it("lists the owner folder and does not move a pointer off Windows", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "adrian-pc-"));
    await writeFile(path.join(root, "notes.txt"), "hello");
    const result = await runAdrianPc({ text: "go to my files", halted: false, root, platform: "linux" });
    assert.equal(result.ran, true);
    assert.match(result.output, /notes.txt/);
    assert.match(result.output, /was not moved|listed/i);
  });

  it("does nothing when the emergency stop is on", async () => {
    const result = await runAdrianPc({ text: "move the mouse and go to my files", halted: true, platform: "win32" });
    assert.equal(result.ran, true);
    assert.match(result.output, /Emergency stop/);
    assert.doesNotMatch(result.output, /moved the pointer/);
  });

  it("ignores a normal question", async () => {
    const result = await runAdrianPc({ text: "What is a file?", halted: false, platform: "linux" });
    assert.equal(result.ran, false);
  });

  it("refuses a spoken purchase before listing files", async () => {
    const result = await runAdrianPc({ text: "buy a laptop and go to my files", halted: false, platform: "linux" });
    assert.equal(result.ran, true);
    assert.match(result.output, /Nothing was purchased/);
    assert.doesNotMatch(result.output, /listed/);
  });

  it("refuses a spoken wipe before any delete", async () => {
    const result = await runAdrianPc({ text: "wipe the disk and go to my files", halted: false, platform: "linux" });
    assert.match(result.output, /Nothing was deleted/);
    assert.doesNotMatch(result.output, /listed/);
  });

  it("writes, reads, and runs a command inside the owner folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "adrian-pc-"));
    const wrote = await runAdrianPc({ text: "write file notes.txt: hello adrian", halted: false, root, platform: "linux" });
    assert.match(wrote.output, /wrote/i);
    const read = await runAdrianPc({ text: "read file notes.txt", halted: false, root, platform: "linux" });
    assert.match(read.output, /hello adrian/);
    const ran = await runAdrianPc({ text: "run command printf ok", halted: false, root, platform: "linux" });
    assert.match(ran.output, /ok/);
  });

  it("does not click on Linux", async () => {
    const result = await runAdrianPc({ text: "click 10 20", halted: false, platform: "linux" });
    assert.match(result.output, /not Windows/);
  });

  it("does not capture the screen on Linux", async () => {
    const result = await runAdrianPc({ text: "look at my screen", halted: false, platform: "linux" });
    assert.equal(result.ran, true);
    assert.match(result.output, /screen was not captured/);
  });
  it("refuses extra pointer and vision actions without claiming they ran", async () => {
    const right = await runAdrianPc({ text: "right-click 12 12", halted: false, platform: "linux" });
    assert.match(right.output, /not Windows/);
    const button = await runAdrianPc({ text: "find button Save", halted: false, platform: "linux" });
    assert.match(button.output, /not clicked/);
    const vision = await runAdrianPc({ text: "understand the screenshot", halted: false, platform: "linux" });
    assert.match(vision.output, /not understood/);
    const worker = await runAdrianPc({ text: "keep working after close", halted: false, platform: "linux" });
    assert.match(worker.output, /Nothing was started/);
  });
});
