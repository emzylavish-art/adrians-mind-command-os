import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
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

describe("authoritative emergency stop", () => {
  const keys = ["VERCEL", "GROK_PROJECT_ID", "DATABASE_URL", "POSTGRES_URL"] as const;
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  beforeEach(() => { for (const key of keys) delete process.env[key]; });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  it("stops on unreadable local state and supports owner recovery", async () => {
    const { readHaltState, haltIsOn, setDurableHalt } = await import("./halt.server.ts");
    const { readdirSync, writeFileSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "mind-halt-authority-"));
    setHaltDirectory(dir);
    assert.equal(await readHaltState("owner"), "off");
    assert.deepEqual(await setDurableHalt("owner", true), {ok: true, halted: true});
    assert.equal(await readHaltState("owner"), "on");
    writeFileSync(join(dir, readdirSync(dir)[0]), "{}");
    assert.equal(await readHaltState("owner"), "unknown");
    assert.equal(await haltIsOn("owner"), true);
    assert.equal(await readHaltState("other"), "off");
    assert.deepEqual(await setDurableHalt("owner", false), {ok: true, halted: false});
    assert.equal(await haltIsOn("owner"), false);
  });

  it("a local off file cannot authorize work or clear an unavailable hosted stop", async () => {
    const { readHaltState, haltIsOn, setDurableHalt } = await import("./halt.server.ts");
    setHaltDirectory(mkdtempSync(join(tmpdir(), "mind-halt-hosted-")));
    writeHaltFile("owner", false);
    process.env.VERCEL = "1";
    assert.equal(await readHaltState("owner"), "unknown");
    assert.equal(await haltIsOn("owner"), true);
    assert.equal((await setDurableHalt("owner", false)).ok, false);
  });
});
