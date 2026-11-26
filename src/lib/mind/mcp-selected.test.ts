import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mcpToolCallText } from "./provider-catalog.ts";
import { runMcpTurn, setMcpDirectory } from "./mcp.ts";
import { collectConsultHelp, planModelConsult } from "./model-consult.ts";

const selected = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";
const other = "cccccccc-cccc-cccc-dddd-eeeeeeeeeeee";

test("confirmation names the selected MCP server and the call does not use the other one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-selected-"));
  setMcpDirectory(dir);
  const userId = "owner-mcp-proof";
  const file = join(dir, createHash("sha256").update(userId).digest("hex") + ".json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({
    servers: [
      { id: other, label: "Other", host: "other.example", url: "https://other.example/mcp", token: "", ownerId: userId, state: "connected", tools: [{ name: "read_file", description: "" }], error: "" },
      { id: selected, label: "Files", host: "files.example", url: "https://files.example/mcp", token: "", ownerId: userId, state: "connected", tools: [{ name: "read_file", description: "" }], error: "" },
    ],
  }));
  const phrase = mcpToolCallText(`mcp:${selected}:read_file`, "notes.txt");
  assert.equal(phrase.ok, true);
  if (!phrase.ok) return;
  const held = await runMcpTurn({ userId, text: phrase.text, confirmed: false, fetch: async () => { throw new Error("fetch must not run before confirmation"); } });
  assert.equal(held.needsConfirmation, true);
  assert.match(held.error, /Files/);
  assert.equal(held.error.includes("Other"), false);
  const called: string[] = [];
  const sent = await runMcpTurn({
    userId,
    text: phrase.text,
    confirmed: true,
    fetch: async (url) => {
      called.push(url);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ result: { content: [{ text: "file text" }] } }) };
    },
  });
  assert.equal(sent.ok, true);
  assert.equal(sent.text, "file text");
  assert.deepEqual(called, ["https://files.example/mcp", "https://files.example/mcp"]);
  assert.equal(called.some((url) => url.includes("other.example")), false);
});

test("orchestrator fan-out asks only explicitly selected helpers within its two-helper budget", async () => {
  const planned = planModelConsult({
    orchestrator: "grok",
    modules: [
      { id: "grok", label: "Grok", connected: true },
      { id: "ollama", label: "Local model", connected: true },
      { id: "openrouter", label: "OpenRouter", connected: true },
    ],
    question: "What is left?",
    helperIds: ["ollama", "openrouter"],
    allowPaidHelpers: true,
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const asked: string[] = [];
  const help = await collectConsultHelp(planned.plan, async (id) => {
    asked.push(id);
    return { ok: true, text: id + " answered" };
  });
  assert.deepEqual(asked, ["ollama", "openrouter"]);
  assert.equal(help.length, 2);
});

test("orchestrator fan-out asks only explicitly authorized connected helpers", async () => {
  const planned = planModelConsult({
    orchestrator: "grok",
    modules: [
      { id: "grok", label: "Grok", connected: true },
      { id: "ollama", label: "Local model", connected: true },
      { id: "openrouter", label: "OpenRouter", connected: true },
    ],
    question: "What is left?",
    authorizedHelpers: ["ollama"],
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const asked: string[] = [];
  const help = await collectConsultHelp(planned.plan, async (id) => {
    asked.push(id);
    return { ok: true, text: id + " answered" };
  });
  assert.deepEqual(asked, ["ollama"]);
  assert.equal(help.length, 1);
  assert.equal(asked.includes("openrouter"), false, "A connected paid route is not implicit consent");
});

test("orchestrator asks only explicitly selected connected helpers", async () => {
  const planned = planModelConsult({
    orchestrator: "grok",
    modules: [
      { id: "grok", label: "Grok", connected: true },
      { id: "ollama", label: "Local model", connected: true },
      { id: "openrouter", label: "OpenRouter", connected: true },
    ],
    question: "What is left?",
    selectedHelpers: ["openrouter"],
  });
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const asked: string[] = [];
  const help = await collectConsultHelp(planned.plan, async (id) => {
    asked.push(id);
    return { ok: true, text: id + " answered" };
  });
  assert.deepEqual(asked, ["openrouter"]);
  assert.equal(help.length, 1);
});
