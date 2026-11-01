import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  listAgents,
  onlineAgents,
  registerAgent,
  setPcPairingDirectory,
} from "./store.ts";
import { runOnPairedAgent } from "./run.ts";

describe("pc pairing", () => {
  it("registers an agent and returns a token once", () => {
    setPcPairingDirectory(mkdtempSync(join(tmpdir(), "pc-pair-")));
    const reg = registerAgent({ ownerId: "owner", label: "Sim PC" });
    assert.equal(reg.ok, true);
    if (!reg.ok) return;
    assert.ok(reg.agentToken.length > 10);
    assert.equal(listAgents("owner").length, 1);
    assert.equal(listAgents("other").length, 0);
  });

  it("requires pairing secret when configured", () => {
    setPcPairingDirectory(mkdtempSync(join(tmpdir(), "pc-pair-")));
    const bad = registerAgent({ ownerId: "owner", expectedPairingSecret: "secret", pairingSecret: "nope" });
    assert.equal(bad.ok, false);
    const good = registerAgent({ ownerId: "owner", expectedPairingSecret: "secret", pairingSecret: "secret" });
    assert.equal(good.ok, true);
  });

  it("runs a job through a simulated polling agent", async () => {
    setPcPairingDirectory(mkdtempSync(join(tmpdir(), "pc-pair-")));
    const reg = registerAgent({ ownerId: "owner", label: "Sim PC" });
    assert.equal(reg.ok, true);
    if (!reg.ok) return;
    assert.equal(onlineAgents("owner").length, 1);

    let finished = false;
    const sim = setInterval(() => {
      const job = claimNextJob(reg.agentId);
      if (!job) return;
      completeJob({ jobId: job.id, agentId: reg.agentId, ok: true, output: "/home/sim\n" });
      finished = true;
      clearInterval(sim);
    }, 15);

    try {
      const result = await runOnPairedAgent({
        ownerId: "owner",
        command: "pwd",
        confirm: false,
        timeoutMs: 3000,
        pollMs: 15,
      });
      assert.ok(result);
      assert.equal(result.ok, true);
      assert.match(result.text, /\/home\/sim/);
      assert.equal(finished, true);
    } finally {
      clearInterval(sim);
    }
  });

  it("enqueues and completes without the waiter helper", () => {
    setPcPairingDirectory(mkdtempSync(join(tmpdir(), "pc-pair-")));
    const reg = registerAgent({ ownerId: "owner" });
    assert.equal(reg.ok, true);
    if (!reg.ok) return;
    const job = enqueueJob({ ownerId: "owner", agentId: reg.agentId, command: "echo hi", confirm: true });
    const claimed = claimNextJob(reg.agentId);
    assert.equal(claimed?.id, job.id);
    const done = completeJob({ jobId: job.id, agentId: reg.agentId, ok: true, output: "hi\n" });
    assert.equal(done?.status, "done");
  });

  it("reports no online agents when lastSeen is stale", () => {
    setPcPairingDirectory(mkdtempSync(join(tmpdir(), "pc-pair-")));
    const reg = registerAgent({ ownerId: "owner" });
    assert.equal(reg.ok, true);
    assert.equal(onlineAgents("owner", 1, Date.now() + 10_000).length, 0);
  });
});
