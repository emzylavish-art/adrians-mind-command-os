#!/usr/bin/env node
/**
 * Tiny stdio MCP fixture server used by registry tests and scripts/mcp/stdio-e2e.mjs.
 * Tools: echo, add, sleep (for timeout tests), env_probe (reports whether env keys are visible).
 * If MCP_FIXTURE_MARKER is set, writes that file on startup so tests can prove (non-)spawn.
 * If MCP_FIXTURE_HANG_INIT=1, never connects (for connect-timeout tests).
 * If MCP_FIXTURE_FLOOD=1, floods stdout with one giant newline-less line (buffer-cap tests).
 * If MCP_FIXTURE_GARBAGE=1, writes malformed JSON-RPC lines and never answers.
 */
import { writeFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

if (process.env.MCP_FIXTURE_MARKER) {
  writeFileSync(process.env.MCP_FIXTURE_MARKER, String(process.pid));
}
process.stderr.write("fixture-stdio-server starting\n");

if (process.env.MCP_FIXTURE_FLOOD === "1") {
  const chunk = "x".repeat(64 * 1024);
  const pump = () => {
    while (process.stdout.write(chunk)) {
      /* keep writing until backpressure */
    }
    process.stdout.once("drain", pump);
  };
  pump();
  setInterval(() => undefined, 1_000);
} else if (process.env.MCP_FIXTURE_GARBAGE === "1") {
  process.stdout.write('{"jsonrpc":"2.0","id":0,"result":\n');
  process.stdout.write("not json at all\n");
  process.stdout.write('{"jsonrpc":"1.0","weird":true}\n');
  setInterval(() => undefined, 1_000);
} else if (process.env.MCP_FIXTURE_HANG_INIT === "1") {
  // Keep the process alive without speaking MCP.
  setInterval(() => undefined, 1_000);
} else {
  const server = new McpServer({ name: "mind-fixture", version: "1.0.0" });
  server.registerTool(
    "echo",
    { description: "Echo back the given text.", inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
  );
  server.registerTool(
    "add",
    { description: "Add two numbers.", inputSchema: { a: z.number(), b: z.number() } },
    async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }], structuredContent: { sum: a + b } , }),
  );
  server.registerTool(
    "sleep",
    { description: "Sleep for ms milliseconds, then answer.", inputSchema: { ms: z.number() } },
    async ({ ms }) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { content: [{ type: "text", text: `slept ${ms}` }] };
    },
  );
  server.registerTool(
    "env_probe",
    { description: "Report which of the given env keys are visible to this process.", inputSchema: { keys: z.array(z.string()) } },
    async ({ keys }) => {
      const visible = Object.fromEntries(keys.map((key) => [key, typeof process.env[key] === "string"]));
      return { content: [{ type: "text", text: JSON.stringify(visible) }] };
    },
  );
  server.registerTool(
    "fail",
    { description: "Always returns an MCP tool error.", inputSchema: {} },
    async () => ({ isError: true, content: [{ type: "text", text: "fixture failure on purpose" }] }),
  );
  await server.connect(new StdioServerTransport());
}
