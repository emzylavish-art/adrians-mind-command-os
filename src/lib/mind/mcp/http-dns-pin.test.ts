import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPrivateAddressLiteral,
  resolveAndPinMcpHostname,
  type DnsLookupFn,
} from "./http-dns-pin.ts";
import {
  callRegistryTool,
  registerExternalServer,
  setMcpRegistryDirectory,
} from "./registry.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const noSql = async () => ({ query: async () => [] });

describe("MCP DNS rebinding guard (resolve + pin)", () => {
  it("refuses when ANY resolved address is private (public then private)", async () => {
    const lookup: DnsLookupFn = async () => ["8.8.8.8", "169.254.169.254"];
    const result = await resolveAndPinMcpHostname("rebinder.example", lookup);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /DNS rebinding|private/i);
  });

  it("refuses private-first dual answers", async () => {
    const result = await resolveAndPinMcpHostname("rebinder.example", async () => [
      "10.0.0.1",
      "1.1.1.1",
    ]);
    assert.equal(result.ok, false);
  });

  it("refuses loopback, ULA, link-local, CGNAT, metadata, IPv4-mapped", async () => {
    for (const address of [
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.0.1",
      "100.64.1.1",
      "169.254.169.254",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "::ffff:a9fe:a9fe",
    ]) {
      assert.equal(isPrivateAddressLiteral(address), true, address);
      const result = await resolveAndPinMcpHostname("x.example", async () => [address]);
      assert.equal(result.ok, false, address);
    }
  });

  it("pins a public IPv4 when dual-stack answers are all public", async () => {
    const result = await resolveAndPinMcpHostname("ok.example", async () => [
      "2001:4860:4860::8888",
      "8.8.8.8",
    ]);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.pinnedAddress, "8.8.8.8");
  });

  it("callRegistryTool never fetches when mocked DNS returns a private second answer", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-dns-")));
    const saved = registerExternalServer("dns-owner", {
      label: "Remote",
      url: "https://rebinder.example/mcp",
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const server = saved.servers.find((s) => s.kind === "http")!;
    let fetched = 0;
    const spy = (async () => {
      fetched += 1;
      throw new Error("should not fetch");
    }) as never;
    let lookups = 0;
    const lookup: DnsLookupFn = async () => {
      lookups += 1;
      // Classic rebinding dual answer: first public, second private.
      return ["203.0.113.10", "127.0.0.1"];
    };
    const called = await callRegistryTool({
      userId: "dns-owner",
      serverId: server.id,
      tool: "x",
      getSql: noSql,
      fetch: spy,
      http: { lookup },
    });
    assert.equal(called.ok, false);
    assert.match(called.text, /rebinding|private|internal/i);
    assert.equal(fetched, 0);
    assert.ok(lookups >= 1);
  });

  it("after a public pin, a second DNS answer is never consulted for the socket (pin sticky)", async () => {
    let calls = 0;
    const answers: string[][] = [["203.0.113.50"], ["169.254.169.254"]];
    const lookup: DnsLookupFn = async () => {
      const next = answers[Math.min(calls, answers.length - 1)]!;
      calls += 1;
      return next;
    };
    const first = await resolveAndPinMcpHostname("sticky.example", lookup);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.pinnedAddress, "203.0.113.50");
    // A later resolve that would rebind must not change the already-chosen pin;
    // callers must keep using first.pinnedAddress (pinnedHttpFetch locks lookup).
    const second = await resolveAndPinMcpHostname("sticky.example", lookup);
    assert.equal(second.ok, false);
    assert.equal(first.pinnedAddress, "203.0.113.50");
    assert.equal(calls, 2);
  });
});
