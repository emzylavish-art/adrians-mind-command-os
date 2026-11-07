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
import { hasForbiddenPollutionKey, readJsonObjectBody, MIND_BODY_UNREADABLE } from "./request-body.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("integration-security-c17", () => {
  it("SSRF block: private IPs and credentialed URLs refused at registration", async () => {
    assert.equal(isPrivateAddressLiteral("10.0.0.1"), true);
    assert.equal(isPrivateAddressLiteral("169.254.169.254"), true);
    assert.equal(isPrivateAddressLiteral("192.168.1.1"), true);
    assert.equal(isPrivateAddressLiteral("8.8.8.8"), false);

    const dir = mkdtempSync(join(tmpdir(), "mcp-reg-c17-"));
    setMcpRegistryDirectory(dir);
    try {
      for (const url of [
        "https://10.1.2.3/rpc",
        "https://169.254.169.254/latest/meta-data",
        "https://192.168.1.1/mcp",
        "https://user:pass@mcp.example/mcp",
        "http://mcp.example/mcp",
      ]) {
        const problem = httpServerUrlProblem(new URL(url));
        assert.ok(problem, `expected refusal for ${url}`);
        const saved = await registerExternalServer("owner-c17", { label: "probe", url });
        assert.equal(saved.ok, false, `should refuse ${url}`);
      }
      assert.equal((await registerExternalServer("owner-c17", { label: "ok", url: "https://mcp.example/mcp" })).ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("SSRF block: rpc does not follow redirects (markers in registry source)", () => {
    const registry = readFileSync(join(root, "src/lib/mind/mcp/registry.ts"), "utf8");
    assert.match(registry, /redirect:\s*"manual"/);
    assert.match(registry, /Redirects are not followed/);
    assert.match(registry, /isPrivateAddressLiteral/);
    assert.match(registry, /Private, link-local and internal IP addresses are refused/);
  });

  it("prototype-pollution reject survives at any depth", async () => {
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
  });

  it("turn + agent routes still call readJsonObjectBody after merge", () => {
    for (const file of ["turn.server.ts", "agent-run.server.ts"]) {
      const source = readFileSync(join(root, "src/lib/mind", file), "utf8");
      assert.match(source, /readJsonObjectBody\(/);
      assert.match(source, /from "\.\/request-body"/);
    }
  });
});
