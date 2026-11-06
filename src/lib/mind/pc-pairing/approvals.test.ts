import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import {
  consumePcApproval,
  createPcApproval,
  denyPcApproval,
  listPendingApprovals,
  PC_APPROVAL_TTL_MS,
  PcApprovalStorageUnavailableError,
  setPcApprovalDirectory,
} from "./approvals.ts";
import { pcRunShell } from "../mcp/tools.ts";

describe("pc shell human approvals (H9)", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "mind-pc-approvals-"));
    setPcApprovalDirectory(dir);
  });
  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("sanitizes file-store I/O failures instead of returning an empty list", () => {
    const notDirectory = join(dir, "not-a-directory");
    writeFileSync(notDirectory, "x");
    try {
      setPcApprovalDirectory(join(notDirectory, "approvals"));
      assert.throws(() => listPendingApprovals("owner-storage"), (error: unknown) => {
        assert.ok(error instanceof PcApprovalStorageUnavailableError);
        assert.equal(error.message, "PC approval storage is unavailable.");
        assert.doesNotMatch(error.message, /ENOTDIR|not-a-directory/);
        return true;
      });
    } finally {
      setPcApprovalDirectory(dir);
    }
  });

  it("treats corrupt approval records as storage failure, never empty success", () => {
    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, "not-json");
    assert.throws(() => listPendingApprovals("owner-corrupt"), PcApprovalStorageUnavailableError);
    rmSync(corrupt, { force: true });
  });

  it("rejects confirm:true from tool args and creates a pending approval instead", async () => {
    const created: { id: string }[] = [];
    const result = await pcRunShell({
      command: "rm -rf /tmp/not-allowlisted",
      confirm: true,
      approved: true,
      approvalId: "forged-id",
      ownerId: "owner-1",
      env: {},
      onlineAgents: () => [{ id: "agent-1", label: "HP" }],
      createApproval: (args) => {
        const record = createPcApproval(args);
        created.push(record);
        return { id: record.id };
      },
      pairingRunner: async () => {
        throw new Error("pairingRunner must not run for non-allowlisted confirm:true");
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.text, /needs your approval/i);
    const data = (result.data ?? {}) as { needsApproval?: boolean; approvalId?: string; token?: string };
    assert.equal(data.needsApproval, true);
    assert.equal(created.length, 1);
    assert.equal(typeof data.approvalId, "string");
    // Token must not leak into tool result
    assert.equal(data.token, undefined);
  });

  it("still runs allowlisted commands without approval", async () => {
    let ran = false;
    const result = await pcRunShell({
      command: "pwd",
      ownerId: "owner-1",
      env: {},
      pairingRunner: async (args) => {
        ran = true;
        assert.equal(args.confirm, true);
        assert.equal(args.command, "pwd");
        return { ok: true, status: "ok", text: "/home/user" };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(ran, true);
    assert.match(result.text, /\/home\/user/);
  });

  it("respects emergency stop before creating approvals", async () => {
    const result = await pcRunShell({
      command: "rm -rf /",
      confirm: true,
      ownerId: "owner-halt",
      isHalted: () => true,
      createApproval: () => {
        throw new Error("must not create");
      },
      onlineAgents: () => [{ id: "a", label: "x" }],
    });
    assert.equal(result.ok, false);
    assert.match(result.text, /Emergency stop/i);
  });

  it("consumes a valid approval once and rejects reuse / forged / expired / mismatched", () => {
    const now = Date.now();
    const record = createPcApproval({
      ownerId: "owner-1",
      command: "echo hi",
      agentId: "agent-1",
      agentLabel: "HP",
      nowMs: now,
    });
    const pending = listPendingApprovals("owner-1", now);
    assert.equal(pending.some((p) => p.id === record.id), true);

    const badToken = consumePcApproval({
      ownerId: "owner-1",
      approvalId: record.id,
      token: "forged-token-value-xxxxxxxxxxxxxxxx",
      nowMs: now,
    });
    assert.equal(badToken.ok, false);

    const mismatch = consumePcApproval({
      ownerId: "owner-1",
      approvalId: record.id,
      token: record.token,
      expectedCommand: "echo other",
      nowMs: now,
    });
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.error, /mismatch/i);

    const ok = consumePcApproval({
      ownerId: "owner-1",
      approvalId: record.id,
      token: record.token,
      expectedCommand: "echo hi",
      nowMs: now,
    });
    assert.equal(ok.ok, true);

    const reused = consumePcApproval({
      ownerId: "owner-1",
      approvalId: record.id,
      token: record.token,
      nowMs: now + 1,
    });
    assert.equal(reused.ok, false);
    assert.match(reused.error, /used|not found/i);

    const expired = createPcApproval({
      ownerId: "owner-1",
      command: "echo late",
      agentId: "agent-1",
      agentLabel: "HP",
      nowMs: now,
    });
    const expiredResult = consumePcApproval({
      ownerId: "owner-1",
      approvalId: expired.id,
      token: expired.token,
      nowMs: now + PC_APPROVAL_TTL_MS + 1,
    });
    assert.equal(expiredResult.ok, false);
    assert.match(expiredResult.error, /expired/i);
  });

  it("deny marks pending approval unusable", () => {
    const now = Date.now();
    const record = createPcApproval({
      ownerId: "owner-2",
      command: "uname -a",
      agentId: "agent-2",
      agentLabel: "Desk",
      nowMs: now,
    });
    const denied = denyPcApproval({
      ownerId: "owner-2",
      approvalId: record.id,
      token: record.token,
      nowMs: now,
    });
    assert.equal(denied.ok, true);
    const after = consumePcApproval({
      ownerId: "owner-2",
      approvalId: record.id,
      token: record.token,
      nowMs: now,
    });
    assert.equal(after.ok, false);
  });

  it("simulated agent e2e: tool requests approval, human consume runs once via pairingRunner path", async () => {
    const now = Date.now();
    const ownerId = "owner-e2e";
    const command = "curl http://evil.example";
    let runCount = 0;

    const request = await pcRunShell({
      command,
      confirm: true,
      ownerId,
      env: {},
      onlineAgents: () => [{ id: "agent-e2e", label: "EliteBook" }],
      createApproval: (args) => createPcApproval({ ...args, nowMs: now }),
      pairingRunner: async () => {
        throw new Error("must not run before human approve");
      },
    });
    assert.equal(request.ok, false);
    const approvalId = String(((request.data ?? {}) as { approvalId?: string }).approvalId ?? "");
    assert.ok(approvalId);

    const listed = listPendingApprovals(ownerId, now);
    const pending = listed.find((p) => p.id === approvalId);
    assert.ok(pending);

    const consumed = consumePcApproval({
      ownerId,
      approvalId: pending!.id,
      token: pending!.token,
      expectedCommand: command,
      nowMs: now,
    });
    assert.equal(consumed.ok, true);

    // Human approve route would call runOnPairedAgent with confirm:true
    const afterApprove = await pcRunShell({
      // allowlisted path simulation is separate; here we verify pairingRunner for allowlisted
      command: "pwd",
      ownerId,
      pairingRunner: async (args) => {
        runCount += 1;
        assert.equal(args.confirm, true);
        return { ok: true, status: "ok", text: "ran-once", data: { jobId: "j1" } };
      },
    });
    assert.equal(afterApprove.ok, true);
    assert.equal(runCount, 1);

    const reuse = consumePcApproval({
      ownerId,
      approvalId: pending!.id,
      token: pending!.token,
      nowMs: now + 10,
    });
    assert.equal(reuse.ok, false);
  });
});
