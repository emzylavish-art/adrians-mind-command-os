import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  acceptJob,
  appendJobEvent,
  offerNextJob,
  requestJobCancel,
  markJobTimeout,
  claimNextJob,
  completeJob,
  enqueueJob,
  listJobEvents,
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

  it("persists Kimi ACP events only for the owning paired agent", () => {
    setPcPairingDirectory(mkdtempSync(join(tmpdir(), "pc-pair-")));
    const reg = registerAgent({ ownerId: "owner" });
    assert.equal(reg.ok, true);
    if (!reg.ok) return;
    const job = enqueueJob({
      ownerId: "owner",
      agentId: reg.agentId,
      kind: "kimi-acp",
      payload: { prompt: "inspect the workspace" },
      command: "kimi acp",
      confirm: false,
    });
    assert.equal(appendJobEvent({ jobId: job.id, agentId: reg.agentId, type: "session_update", payload: { text: "hello" } })?.jobId, job.id);
    assert.equal(listJobEvents("owner", job.id).length, 1);
    assert.equal(listJobEvents("other-owner", job.id).length, 0);
    assert.equal(appendJobEvent({ jobId: job.id, agentId: "000000000000000000000000", type: "forged" }), null);
  });

  it("recovers a lost offer and a lost acceptance response without authorizing a second receipt", () => {
    setPcPairingDirectory(mkdtempSync(join(tmpdir(), "pc-delivery-")));
    const job = enqueueJob({ ownerId: "owner", agentId: "a", command: "task", confirm: false });
    assert.equal(offerNextJob("a")?.id, job.id);
    assert.equal(offerNextJob("a")?.status, "queued");
    assert.equal(acceptJob("b", job.id, "receipt"), null);
    assert.equal(acceptJob("a", job.id, "receipt")?.status, "running");
    assert.equal(acceptJob("a", job.id, "receipt")?.status, "running");
    assert.equal(offerNextJob("a"), null);
    assert.equal(acceptJob("a", job.id, "different"), null);
    assert.equal(requestJobCancel("owner", job.id)?.status, "cancel_requested");
    assert.equal(completeJob({ jobId: job.id, agentId: "a", ok: true })?.status, "cancelled");
    assert.equal(completeJob({ jobId: job.id, agentId: "a", ok: true })?.status, "cancelled");
  });

  it("preserves complete file results, terminal state and bounded shell logs", () => {
    setPcPairingDirectory(mkdtempSync(join(tmpdir(), "pc-results-")));
    const args = { agentId: "a", ownerId: "owner", command: "test", confirm: true };
    const output = JSON.stringify({ before: "\u0000".repeat(1_000_000), after: "\u0000".repeat(1_000_000) });
    const file = enqueueJob({ ...args, kind: "file-op" });
    assert.equal(completeJob({ ...args, jobId: file.id, ok: true, output: "{}" }), null);
    claimNextJob(args.agentId);
    assert.equal(completeJob({ ...args, jobId: file.id, ok: true, output })?.output, output);
    markJobTimeout(file.id);
    assert.equal(completeJob({ ...args, jobId: file.id, ok: false })?.output, output);
    const shell = enqueueJob(args);
    claimNextJob(args.agentId);
    assert.equal(completeJob({ ...args, jobId: shell.id, ok: true, output })?.output?.length, 8000);
    const timed = enqueueJob(args);
    markJobTimeout(timed.id);
    assert.equal(completeJob({ ...args, jobId: timed.id, ok: true })?.status, "timeout");
  });

  it("reports no online agents when lastSeen is stale", () => {
    setPcPairingDirectory(mkdtempSync(join(tmpdir(), "pc-pair-")));
    const reg = registerAgent({ ownerId: "owner" });
    assert.equal(reg.ok, true);
    assert.equal(onlineAgents("owner", 1, Date.now() + 10_000).length, 0);
  });
});
