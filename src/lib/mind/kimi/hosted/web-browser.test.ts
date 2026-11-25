import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { closeCodingBrowser, codingBrowserFrame, codingBrowserStatus, ensureCodingBrowser } from "./web-browser.server.ts";

test("concurrent starts and repeated frames reuse the owning process", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "mind-browser-test-"));
  const script = join(dir, "fixture.mjs");
  const savedEnv = { ...process.env };
  t.after(async () => {
    await closeCodingBrowser("A");
    await closeCodingBrowser("B");
    for (const key of ["KIMI_BIN", "ADRIAN_DATA_DIR", "VERCEL"]) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(script, `
    import {createServer} from 'node:http';
    import {writeFileSync} from 'node:fs';
    import {randomUUID} from 'node:crypto';
    writeFileSync(process.env.KIMI_CODE_HOME + '/server.token', randomUUID());
    createServer((req,res)=>res.end('ready')).listen(Number(process.argv.at(-1)), '127.0.0.1');
  `);
  process.env.KIMI_BIN = script;
  process.env.ADRIAN_DATA_DIR = dir;
  delete process.env.VERCEL;
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith(":58641/search")) return Promise.resolve(new Response("{}"));
    return realFetch(input, init);
  });
  assert.equal(await codingBrowserFrame("A"), null);
  const results = await Promise.all([ensureCodingBrowser("A"), ensureCodingBrowser("A")]);
  assert.ok(results.every((result) => result.ok));
  const original = await codingBrowserFrame("A");
  assert.ok(original);
  assert.ok((await ensureCodingBrowser("A")).ok);
  assert.equal(await codingBrowserFrame("A"), original);
  assert.equal(codingBrowserStatus("B").running, false);
  assert.equal(await codingBrowserFrame("B"), null);
  assert.equal(await closeCodingBrowser("B"), false);
  assert.equal((await ensureCodingBrowser("B")).ok, false);
  assert.equal(await closeCodingBrowser("A"), true);
  assert.equal(await codingBrowserFrame("A"), null);
  assert.ok((await ensureCodingBrowser("B")).ok);
  assert.notEqual(await codingBrowserFrame("B"), original);
});
