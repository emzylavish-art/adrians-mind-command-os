import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("Companion sends a durable cancel receipt only after the coding process exits", { skip: process.platform === "win32", timeout: 25_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), "adrian-companion-cancel-"));
  const processRecord = join(root, "coding-process");
  const job = join(root, "job.json");
  const config = join(root, "config.json");
  const fixture = join(root, "fake-kimi");
  const receiptId = "a".repeat(32);
  let running = true;
  let queries = 0;
  const responses = [];

  const api = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    response.setHeader("content-type", "application/json");
    if (url.pathname.endsWith("/jobs")) {
      queries++;
      const prompt = await readFile(processRecord, "utf8").catch(() => "");
      response.end(JSON.stringify({ job: { status: prompt ? "cancel_requested" : "running" } }));
      return;
    }
    if (url.pathname.endsWith("/result")) {
      let content = "";
      for await (const chunk of request) content += chunk;
      responses.push(JSON.parse(content));
      try {
        process.kill(Number(await readFile(processRecord, "utf8")), 0);
      } catch (error) {
        if (error.code === "ESRCH") running = false;
      }
      if (responses.length === 1) response.statusCode = 503;
    }
    response.end(JSON.stringify({ ok: response.statusCode < 400 }));
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  t.after(async () => {
    await new Promise(resolveClose => api.close(resolveClose));
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(fixture, `#!/usr/bin/env node
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
process.on("SIGTERM", () => {});
createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.method === "session/prompt") {
    writeFileSync(${JSON.stringify(processRecord)}, String(process.pid), { flag: "wx" });
    return;
  }
  const result = message.method === "session/new" ? { sessionId: "fixture" } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
});
`, { mode: 0o700 });
  await writeFile(config, JSON.stringify({
    dashboardUrl: "http://127.0.0.1:" + api.address().port,
    allowedRoots: [root], kimiPath: fixture, jobToken: "fixture-only",
  }));
  await writeFile(job, JSON.stringify({ id: "job", receiptId, kind: "kimi-acp", payload: { prompt: "Fixture task", cwd: root } }));
  async function run() {
    const worker = spawn(process.execPath, ["agent/windows/KimiAcpClient.mjs", "--config", config, "--job-json", job], { stdio: "ignore", signal: AbortSignal.timeout(10_000) });
    const [status] = await once(worker, "exit");
    return status;
  }

  assert.equal(await run(), 1, "An unacknowledged result stays on disk");
  assert.equal(running, false, "Cancellation receipt followed process exit");
  assert.deepEqual(responses[0], { jobId: "job", ok: false, cancelled: true, output: "", receiptId });
  const checked = queries;
  assert.equal(await run(), 0);
  assert.deepEqual(responses[1], responses[0]);
  assert.equal(queries, checked, "Reconciliation sends only the saved result");
});
