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
import { runApprovedOnPairedAgent, runOnPairedAgent } from "./run.ts";

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

describe("pc approval agent binding (attack: approved command hops to another PC)", () => {
  /** Two online PCs for one owner; `approved` is deliberately NOT the first online agent. */
  function twoAgents() {
    setPcPairingDirectory(mkdtempSync(join(tmpdir(), "pc-pair-bind-")));
    registerAgent({ ownerId: "owner", label: "PC one" });
    registerAgent({ ownerId: "owner", label: "PC two" });
    const online = onlineAgents("owner");
    assert.equal(online.length, 2);
    return { other: online[0], approved: online[1] };
  }

  /** Simulated polling agents: record which PC actually received and ran each job. */
  function simulate(agents: { id: string; label: string }[]) {
    const ranOn: { label: string; command: string; confirm: boolean }[] = [];
    const timer = setInterval(() => {
      for (const agent of agents) {
        const job = claimNextJob(agent.id);
        if (!job) continue;
        ranOn.push({ label: agent.label, command: job.command, confirm: job.confirm });
        completeJob({ jobId: job.id, agentId: agent.id, ok: true, output: `ran on ${agent.label}` });
      }
    }, 5);
    return { ranOn, stop: () => clearInterval(timer) };
  }

  it("runs a human-approved command only on the approved PC, never the first online one", async () => {
    const { approved, other } = twoAgents();
    const sim = simulate([other, approved]);
    try {
      const result = await runApprovedOnPairedAgent({
        ownerId: "owner",
        record: { command: "rm -rf build", agentId: approved.id, agentLabel: approved.label },
        timeoutMs: 2000,
        pollMs: 5,
      });
      assert.ok(result);
      assert.equal(result.ok, true);
      assert.match(result.text, new RegExp(`ran on ${approved.label}`));
    } finally {
      sim.stop();
    }
    assert.deepEqual(
      sim.ranOn,
      [{ label: approved.label, command: "rm -rf build", confirm: true }],
      "approved command must not hop to a different paired PC",
    );
  });

  it("refuses (nothing queued anywhere) when the approved PC is offline but another PC is online", async () => {
    const { other } = twoAgents();
    const sim = simulate([other]);
    try {
      const result = await runApprovedOnPairedAgent({
        ownerId: "owner",
        record: { command: "whoami", agentId: "f".repeat(24), agentLabel: "Gone PC" },
        timeoutMs: 200,
        pollMs: 5,
      });
      assert.equal(result, null);
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      sim.stop();
    }
    assert.deepEqual(sim.ranOn, []);
  });

  it("refuses an approval that names another owner's PC", async () => {
    setPcPairingDirectory(mkdtempSync(join(tmpdir(), "pc-pair-bind-")));
    const mine = registerAgent({ ownerId: "owner", label: "Mine" });
    const theirs = registerAgent({ ownerId: "someone-else", label: "Theirs" });
    if (!mine.ok || !theirs.ok) throw new Error("register failed");
    const sim = simulate([
      { id: mine.agentId, label: "Mine" },
      { id: theirs.agentId, label: "Theirs" },
    ]);
    try {
      const result = await runApprovedOnPairedAgent({
        ownerId: "owner",
        record: { command: "whoami", agentId: theirs.agentId, agentLabel: "Theirs" },
        timeoutMs: 200,
        pollMs: 5,
      });
      assert.equal(result, null);
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      sim.stop();
    }
    assert.deepEqual(sim.ranOn, []);
  });

  it("refuses an approval record with no agent id instead of falling back to any PC", async () => {
    const { approved, other } = twoAgents();
    const sim = simulate([other, approved]);
    try {
      const result = await runApprovedOnPairedAgent({
        ownerId: "owner",
        record: { command: "whoami", agentId: "", agentLabel: "" },
        timeoutMs: 200,
        pollMs: 5,
      });
      assert.equal(result, null);
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      sim.stop();
    }
    assert.deepEqual(sim.ranOn, []);
  });

  it("runOnPairedAgent with agentId pins dispatch to that PC", async () => {
    const { approved, other } = twoAgents();
    const sim = simulate([other, approved]);
    try {
      const result = await runOnPairedAgent({
        ownerId: "owner",
        command: "pwd",
        confirm: false,
        agentId: approved.id,
        timeoutMs: 2000,
        pollMs: 5,
      });
      assert.equal(result?.ok, true);
    } finally {
      sim.stop();
    }
    assert.deepEqual(sim.ranOn.map((r) => r.label), [approved.label]);
  });

  it("approve route dispatches via the agent-bound helper (no unpinned runOnPairedAgent)", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync(join(process.cwd(), "src/routes/api/mind/pc/approve.ts"), "utf8");
    assert.match(route, /runApprovedOnPairedAgent\(/);
    assert.doesNotMatch(route, /runOnPairedAgent\(/);
  });
});
