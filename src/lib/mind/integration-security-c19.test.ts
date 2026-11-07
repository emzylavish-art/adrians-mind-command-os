import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  httpServerUrlProblem,
  isPrivateAddressLiteral,
  registerExternalServer,
  setMcpRegistryDirectory,
} from "./mcp/registry.ts";
import { pcRunShell } from "./mcp/tools.ts";
import {
  createPcApproval,
  listPendingApprovals,
  setPcApprovalDirectory,
} from "./pc-pairing/approvals.ts";
import { hasForbiddenPollutionKey, readJsonObjectBody, MIND_BODY_UNREADABLE } from "./request-body.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("integration-security-c19", () => {
  it("H9: confirm:true from tool args cannot authorize non-allowlisted shell", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-pc-approvals-c19-"));
    setPcApprovalDirectory(dir);
    try {
      const created: { id: string }[] = [];
      const result = await pcRunShell({
        command: "rm -rf /tmp/c19-should-not-run",
        confirm: true,
        approved: true,
        approvalId: "forged-c19",
        ownerId: "owner-c19",
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
      assert.match(result.text, /ignored/i);
      const data = (result.data ?? {}) as { needsApproval?: boolean; approvalId?: string; token?: string };
      assert.equal(data.needsApproval, true);
      assert.equal(created.length, 1);
      assert.equal(typeof data.approvalId, "string");
      assert.equal(data.token, undefined);
      const pending = listPendingApprovals("owner-c19");
      assert.ok(pending.some((p) => p.id === data.approvalId));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("H9 markers: tools ignore client confirm; approvals module present", () => {
    const tools = readFileSync(join(root, "src/lib/mind/mcp/tools.ts"), "utf8");
    assert.match(tools, /void input\.confirm/);
    assert.match(tools, /Tool confirm\/approved flags are ignored|confirm tool args are ignored|Tool confirm flags are ignored/);
    const approvals = readFileSync(join(root, "src/lib/mind/pc-pairing/approvals.ts"), "utf8");
    assert.match(approvals, /listPendingApprovals/);
    assert.match(approvals, /createPcApproval/);
    assert.match(approvals, /consumePcApproval/);
  });

  it("c17 SSRF guards survive: private IPs refused; redirects manual", async () => {
    assert.equal(isPrivateAddressLiteral("10.0.0.1"), true);
    assert.equal(isPrivateAddressLiteral("169.254.169.254"), true);
    assert.equal(isPrivateAddressLiteral("192.168.0.5"), true);
    assert.equal(isPrivateAddressLiteral("8.8.8.8"), false);

    const dir = mkdtempSync(join(tmpdir(), "mcp-reg-c19-"));
    setMcpRegistryDirectory(dir);
    try {
      for (const url of [
        "https://10.1.2.3/rpc",
        "https://169.254.169.254/latest/meta-data",
        "https://192.168.1.1/mcp",
        "https://user:pass@mcp.example/mcp",
        "http://mcp.example/mcp",
      ]) {
        assert.ok(httpServerUrlProblem(new URL(url)), `expected refusal for ${url}`);
        assert.equal((await registerExternalServer("owner-c19", { label: "probe", url })).ok, false);
      }
      assert.equal((await registerExternalServer("owner-c19", { label: "ok", url: "https://mcp.example/mcp" })).ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const registry = readFileSync(join(root, "src/lib/mind/mcp/registry.ts"), "utf8");
    assert.match(registry, /redirect:\s*"manual"/);
    assert.match(registry, /isPrivateAddressLiteral/);
  });

  it("c17 proto-pollution guards survive at any depth + route wiring", async () => {
    assert.equal(hasForbiddenPollutionKey(JSON.parse('{"__proto__":{"x":1}}')), true);
    assert.equal(hasForbiddenPollutionKey(JSON.parse('{"a":{"constructor":{"prototype":{"x":1}}}}')), true);
    assert.equal(hasForbiddenPollutionKey(JSON.parse('{"text":"hi","nested":{"ok":true}}')), false);

    const polluted = await readJsonObjectBody(
      new Request("http://127.0.0.1/api/mind/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"__proto__":{"polluted":true},"text":"hi"}',
      }),
    );
    assert.equal(polluted.ok, false);
    if (!polluted.ok) {
      assert.equal(polluted.status, 400);
      assert.equal(polluted.error, MIND_BODY_UNREADABLE);
    }

    for (const file of ["turn.server.ts", "agent-run.server.ts"]) {
      const source = readFileSync(join(root, "src/lib/mind", file), "utf8");
      assert.match(source, /readJsonObjectBody\(/);
      assert.match(source, /from "\.\/request-body"/);
    }
  });
});
