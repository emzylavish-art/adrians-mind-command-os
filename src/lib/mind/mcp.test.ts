import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { allowedMcpUrl, listMcp, parseMcpIntent, probeMcp, removeMcp, runMcpTurn, saveMcp, setMcpDirectory } from "./mcp.ts";

function fakeFetch(bodies: Record<string, { status?: number; body: string; session?: string }>) {
  const calls: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const message = JSON.parse(String(init?.body)) as { method?: string };
    calls.push(`${message.method} ${url}`);
    const hit = bodies[message.method ?? ""] ?? { status: 500, body: "" };
    return {
      ok: (hit.status ?? 200) < 400,
      status: hit.status ?? 200,
      headers: { get: (name: string) => (name === "mcp-session-id" ? hit.session ?? null : null) },
      text: async () => hit.body,
    };
  };
  return { fetch, calls };
}

const listed = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "echo", description: "Echo a line" }] } });
const init = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", serverInfo: { name: "demo", version: "1" } } });

describe("mcp", () => {
  it("rejects a public http URL and a secret inside the URL", () => {
    assert.equal(allowedMcpUrl("http://example.com/mcp").ok, false);
    assert.equal(allowedMcpUrl("https://user:secret@example.com/mcp").ok, false);
    assert.equal(allowedMcpUrl("https://mcp.example/tools").ok, true);
    assert.equal(allowedMcpUrl("http://127.0.0.1:3000/mcp").ok, true);
  });

  it("keeps one owner's server off another owner and never returns the token", () => {
    setMcpDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-")));
    const saved = saveMcp("owner-a", { label: "Desk", url: "https://mcp.example/tools", token: "super-secret" });
    assert.equal(saved.ok, true);
    assert.equal(JSON.stringify(saved).includes("super-secret"), false);
    assert.equal(listMcp("owner-b").length, 0);
    if (saved.ok) assert.equal(removeMcp("owner-a", saved.server.id).length, 0);
  });

  it("marks a server connected only after initialize and tools/list", async () => {
    setMcpDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-")));
    const saved = saveMcp("owner", { label: "Desk", url: "https://mcp.example/tools", token: "super-secret" });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.server.state, "unchecked");
    const { fetch, calls } = fakeFetch({
      initialize: { body: init, session: "sess-1" },
      "notifications/initialized": { body: "" },
      "tools/list": { body: listed },
    });
    const probed = await probeMcp("owner", saved.server.id, fetch);
    assert.equal(probed.state, "connected");
    assert.deepEqual(probed.tools.map((tool) => tool.name), ["echo"]);
    assert.equal(calls.some((call) => call.startsWith("tools/list")), true);
    assert.equal(JSON.stringify(probed).includes("super-secret"), false);
  });

  it("does not mark a failed handshake connected", async () => {
    setMcpDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-")));
    const saved = saveMcp("owner", { label: "Desk", url: "https://mcp.example/tools", token: "" });
    if (!saved.ok) return;
    const probed = await probeMcp("owner", saved.server.id, fakeFetch({ initialize: { status: 401, body: "" } }).fetch);
    assert.equal(probed.state, "failed");
    assert.equal(probed.tools.length, 0);
  });

  it("lists tools from the server and waits before a tool call", async () => {
    setMcpDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-")));
    saveMcp("owner", { label: "Desk", url: "https://mcp.example/tools", token: "super-secret" });
    const { fetch, calls } = fakeFetch({
      initialize: { body: init, session: "sess-1" },
      "notifications/initialized": { body: "" },
      "tools/list": { body: listed },
      "tools/call": { body: JSON.stringify({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "pong" }] } }) },
    });
    const listedTurn = await runMcpTurn({ userId: "owner", text: "list my mcp tools", confirmed: false, fetch });
    assert.match(listedTurn.text, /echo/);
    const held = await runMcpTurn({ userId: "owner", text: "call mcp tool echo hello", confirmed: false, fetch });
    assert.equal(held.needsConfirmation, true);
    assert.equal(calls.some((call) => call.startsWith("tools/call")), false);
    const called = await runMcpTurn({ userId: "owner", text: "call mcp tool echo hello", confirmed: true, fetch });
    assert.equal(called.text, "pong");
    assert.equal(JSON.stringify(called).includes("super-secret"), false);
  });

  it("says nothing was called when no server is saved", async () => {
    setMcpDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-")));
    const result = await runMcpTurn({ userId: "owner", text: "list mcp tools", confirmed: true, fetch: fakeFetch({}).fetch });
    assert.match(result.error, /Nothing was called/);
    assert.equal(parseMcpIntent("What is a pier?").action, "unclear");
  });
});
