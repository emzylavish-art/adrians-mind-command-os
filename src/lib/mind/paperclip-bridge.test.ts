import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPaperclipSnapshot, paperclipConfig, paperclipOwnerAllowed } from "./paperclip-bridge.server.ts";

const env = {
  PAPERCLIP_API_URL: "https://paperclip.example.com",
  PAPERCLIP_API_KEY: "paperclip-test-key",
  PAPERCLIP_COMPANY_ID: "company-1234",
};
const pin = async (hostname: string) =>
  ({ ok: true as const, hostname, pinnedAddress: "203.0.113.20", addresses: ["203.0.113.20"] });

describe("Paperclip read-only bridge", () => {
  it("enforces explicit owner binding before revealing company status", () => {
    assert.equal(paperclipOwnerAllowed("owner", env), false);
    assert.equal(paperclipOwnerAllowed("other", { ...env, PAPERCLIP_OWNER_USER_ID: "owner" }), false);
    assert.equal(paperclipOwnerAllowed("owner", { ...env, PAPERCLIP_OWNER_USER_ID: "owner" }), true);
  });

  it("refuses unconfigured or unsafe URLs without calling a service", async () => {
    assert.equal(paperclipConfig({ ...env, PAPERCLIP_API_URL: "http://localhost:3100", PAPERCLIP_API_KEY: "key" }), null);
    assert.equal(paperclipConfig({ ...env, PAPERCLIP_API_URL: "http://127.0.0.1:3100" }), null);
    assert.equal(paperclipConfig({ ...env, PAPERCLIP_API_URL: "https://user:pw@example.com" }), null);
    let called = false;
    const result = await getPaperclipSnapshot({}, {
      pin: async () => { called = true; return pin("ignored"); },
    });
    assert.equal(result.state, "not_configured");
    assert.equal(called, false);
  });
  it("reports genuine agents and runs only after all authenticated reads succeed", async () => {
    const paths: string[] = [];
    const result = await getPaperclipSnapshot(env, {
      pin,
      request: async (url, address, hostname, init) => {
        assert.equal(address, "203.0.113.20");
        assert.equal(hostname, "paperclip.example.com");
        assert.equal((init.headers as Record<string, string>).authorization, "Bearer paperclip-test-key");
        paths.push(url.pathname);
        let data: unknown;
        if (url.pathname === "/api/health") data = { status: "ok" };
        else if (url.pathname.endsWith("/agents")) data = [{ id: "a1", name: "Auditor", role: "engineer", status: "ready", secret: "do-not-expose" }];
        else data = [{ id: "run1", agentId: "a1", status: "succeeded" }];
        return { ok: true, status: 200, text: async () => JSON.stringify(data) };
      },
    });
    assert.deepEqual(paths, [
      "/api/health", "/api/companies/company-1234/agents",
      "/api/companies/company-1234/heartbeat-runs",
    ]);
    assert.equal(result.state, "connected");
    assert.equal(result.agents[0]?.name, "Auditor");
    assert.equal(result.runs[0]?.status, "succeeded");
    assert.equal(JSON.stringify(result).includes("do-not-expose"), false);
    assert.equal(JSON.stringify(result).includes("paperclip-test-key"), false);
  });
  it("does not call a fleet connected if permissions or runtime health fail", async () => {
    const result = await getPaperclipSnapshot(env, {
      pin,
      request: async (url) => ({ ok: url.pathname === "/api/health", status: url.pathname === "/api/health" ? 200 : 401,
        text: async () => JSON.stringify({ status: "ok" }) }),
    });
    assert.equal(result.state, "unavailable");
    assert.deepEqual(result.agents, []);
  });
  it("refuses DNS pin failures", async () => {
    let calls = 0;
    const result = await getPaperclipSnapshot(env, {
      pin: async () => ({ ok: false as const, error: "private host" }),
      request: async () => { calls += 1; throw new Error("should not call"); },
    });
    assert.equal(result.state, "unavailable");
    assert.equal(calls, 0);
  });
});
