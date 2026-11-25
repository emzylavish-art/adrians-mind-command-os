import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const worker = fileURLToPath(new URL("../../agent/windows/KimiAcpClient.mjs", import.meta.url));

test("a paired worker resends its original receipt without rewriting an intervening edit", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pc-worker-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "workspace");
  const file = join(root, "note.txt");
  const config = join(dir, "config.json");
  const jobFile = join(dir, "job.json");
  await mkdir(root);
  const results = [];
  let disconnect = true;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer fixture-job-credential");
    if (req.url === "/api/mind/pc/result") {
      let text = "";
      for await (const part of req) text += part;
      results.push(JSON.parse(text));
      if (disconnect) { req.socket.destroy(); return; }
    }
    res.end(JSON.stringify({ ok: true, job: { status: "running" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await writeFile(config, "\uFEFF" + JSON.stringify({
    tokenId: "device", token: "device-only", jobToken: "fixture-job-credential", allowedRoots: [root],
    dashboardUrl: `http://127.0.0.1:${server.address().port}`,
  }));
  const job = { id: "file-write", kind: "file-op", payload: { operation: "write", path: "note.txt", content: "saved", expectedContent: "original" } };
  await writeFile(jobFile, JSON.stringify(job));
  await writeFile(file, "original");
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, "--config", config, "--job-json", jobFile], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  assert.equal(await run(), 1);
  assert.equal(await readFile(file, "utf8"), "saved");
  await writeFile(file, "later edit");
  disconnect = false;
  assert.equal(await run(), 0);
  assert.equal(await readFile(file, "utf8"), "later edit");
  assert.deepEqual(results[1], results[0]);
  assert.equal(JSON.parse(results[1].output).cwd, root);
  // A second, separately issued save with the old expected text must conflict.
  await rm(jobFile + ".result");
  await rm(jobFile + ".started");
  job.id = "new-write";
  await writeFile(jobFile, JSON.stringify(job));
  assert.equal(await run(), 0);
  assert.equal(results.at(-1).ok, false);
  assert.match(results.at(-1).error, /changed/);
  assert.equal(await readFile(file, "utf8"), "later edit");
  async function nextOperation(id, payload) {
    await rm(jobFile + ".result", { force: true });
    await rm(jobFile + ".started", { force: true });
    await writeFile(jobFile, JSON.stringify({ ...job, id, payload: { ...payload, path: "note.txt" } }));
    assert.equal(await run(), 0);
    return results.at(-1);
  }
  const read = await nextOperation("review", { operation: "read" });
  const revision = JSON.parse(read.output).revision;
  assert.equal(typeof revision, "string");
  await rename(file, file + ".old");
  await writeFile(file, "later edit");
  const deletion = await nextOperation("delete", { operation: "delete", confirm: true, expectedRevision: revision });
  assert.equal(deletion.ok, false);
  const renaming = await nextOperation("rename", { operation: "rename", to: "renamed.txt", confirm: true, expectedRevision: revision });
  assert.equal(renaming.ok, false);
  assert.equal(await readFile(file, "utf8"), "later edit");
  const creation = await nextOperation("create", { operation: "write", content: "replacement", expectedMissing: true });
  assert.equal(creation.ok, false);

  // Recover a crashed worker with a durable intent but no trustworthy outcome.
  // Simulate a replaced file at the same path before replay of an old deletion.
  await rm(jobFile + ".result");
  await writeFile(jobFile + ".started", JSON.stringify({ jobId: "interrupted", pid: 2147483647 }));
  await writeFile(jobFile, JSON.stringify({ ...job, id: "interrupted", payload: { operation: "delete", path: "note.txt", confirm: true } }));
  assert.equal(await run(), 0);
  assert.match(results.at(-1).error, /stopped before recording/);
  assert.equal(await readFile(file, "utf8"), "later edit");
});

test("two dashboard processes can claim a shared queued job only once", async t => {
  const storeUrl = new URL("../../src/lib/mind/pc-pairing/store.ts", import.meta.url).href;
  const store = await import(storeUrl);
  const dir = await mkdtemp(join(tmpdir(), "pc-claim-race-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  store.setPcPairingDirectory(dir);
  const job = store.enqueueJob({ ownerId: "fixture", agentId: "same", command: "test", confirm: false });
  const compete = receipt => new Promise((resolve, reject) => {
    const code = `const store = await import(process.argv[1]); store.setPcPairingDirectory(process.argv[2]);
      const accepted = store.acceptJob("same", process.argv[3], process.argv[4]); process.stdout.write(accepted ? "yes" : "no");`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, storeUrl, dir, job.id, receipt]);
    let answer = "";
    child.stdout.on("data", part => { answer += part; });
    child.on("error", reject);
    child.on("close", status => status === 0 ? resolve(answer) : reject(Error("Claim process failed")));
  });
  assert.deepEqual((await Promise.all([compete("one"), compete("two")])).sort(), ["no","yes"]);
});
