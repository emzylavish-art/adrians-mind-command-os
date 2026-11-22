import assert from "node:assert/strict";
import test from "node:test";
import { catalogModuleChoices, discoveredCapabilities, mcpToolCallText } from "./provider-catalog.ts";
import { normalizeBotModel } from "./bot-model.ts";

test("a connected API keeps every model it returns, including ones not hardcoded", () => {
  const choices = catalogModuleChoices([{
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    label: "Future API",
    models: ["known-model", "future/vendor-model:free", "another-one"],
  }]);
  assert.equal(choices.length, 3);
  assert.equal(choices[1].label, "Future API: future/vendor-model:free");
  assert.equal(choices.some((item) => item.id.includes("future%2Fvendor-model%3Afree")), true);
});

test("a discovered model can be saved on a bot and an unknown string cannot", () => {
  const id = "custom:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:future%2Fmodel";
  assert.equal(normalizeBotModel({ chatProvider: id }).chatProvider, id);
  assert.equal(normalizeBotModel({ chatProvider: "not-a-module" }).chatProvider, null);
});

test("MCP tools sit in the same discovery list and a selected tool is called by name", () => {
  const found = discoveredCapabilities({
    models: [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", label: "Future API", models: ["one"] }],
    mcp: [{ id: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", label: "Files", state: "connected", tools: [{ name: "read_file", description: "Read a file" }, { name: "write_file" }] }],
  });
  assert.deepEqual(found.map((item) => item.kind), ["model", "mcp-tool", "mcp-tool"]);
  const call = mcpToolCallText(found[1].id, "notes.txt");
  assert.equal(call.ok && call.text, "call mcp tool read_file on server bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee notes.txt");
  const gated = discoveredCapabilities({ models: [], mcp: [{ id: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", label: "Files", state: "failed", tools: [{ name: "read_file" }] }] });
  assert.equal(gated[0].usable, false);
});
