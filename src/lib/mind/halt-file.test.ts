import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { readHaltFile, setHaltDirectory, writeHaltFile } from "./halt-file.ts";

describe("C5 emergency stop server action validation", () => {
  it("malformed stop input cannot release protection; explicit owner actions retain their meaning", async () => {
    const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
    const action = source.slice(source.indexOf("export const setExecutionHalt ="), source.indexOf("export const saveMindCopy ="));
    const calls: { ownerId: string; on: boolean }[] = [];
    const module = { exports: {} as { setExecutionHalt: (input: unknown) => Promise<{ ok: boolean }> } };
    const createServerFn = () => ({ middleware: () => ({ validator: (validate: (input: unknown) => unknown) => ({ handler: (handle: (input: unknown) => unknown) => async (input: unknown) => handle({ data: validate(input), context: { userId: "owner-a" } }) }) }) });
    const code = ts.transpileModule(action, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    runInNewContext(code, { module, exports: module.exports, createServerFn, authMiddleware: {}, require: (name: string) => {
      assert.equal(name, "./halt.server");
      return { setDurableHalt: async (ownerId: string, on: boolean) => { calls.push({ ownerId, on }); return { ok: true, halted: on }; } };
    } });
    const invoke = module.exports.setExecutionHalt;
    for (const input of [undefined, null, {}, { on: "false" }, { on: 0 }, { on: null }, { on: true, ownerId: "" }, { on: false, ownerId: 7 }]) {
      await assert.rejects(invoke(input), /explicit stop or release/);
    }
    assert.equal(calls.length, 0);
    assert.equal((await invoke({ on: false, ownerId: "owner-b" })).ok, false);
    assert.equal(calls.length, 0);
    assert.equal((await invoke({ on: true, ownerId: "owner-a" })).ok, true);
    assert.equal((await invoke({ on: false, ownerId: "owner-a" })).ok, true);
    assert.deepEqual(calls, [{ ownerId: "owner-a", on: true }, { ownerId: "owner-a", on: false }]);
  });
});

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
    assert.equal((await setDurableHalt("owner", true)).ok, true);
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
