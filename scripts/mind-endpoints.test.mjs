import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function sliceExport(source, name, next) {
  const start = source.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} is missing`);
  const end = next ? source.indexOf(`export const ${next}`, start + 1) : source.length;
  return source.slice(start, end === -1 ? undefined : end);
}

test("protected mind operations require the owner on the server", () => {
  const server = readFileSync(new URL("../src/lib/mind/server.ts", import.meta.url), "utf8");
  const rea = readFileSync(new URL("../src/lib/mind/rea.ts", import.meta.url), "utf8");
  const turn = readFileSync(new URL("../src/lib/mind/turn.server.ts", import.meta.url), "utf8");
  for (const name of ["sendTurn", "setExecutionHalt", "saveMindCopy", "loadMindCopy", "speakText", "searchWeb", "inspectWebPage"]) {
    assert.match(sliceExport(server, name), /\.middleware\(\[authMiddleware\]\)/);
  }
  assert.doesNotMatch(sliceExport(server, "mindStatus", "searchWeb"), /authMiddleware/);
  for (const name of ["reaDoctor", "reaInspect"]) {
    assert.match(sliceExport(rea, name), /\.middleware\(\[authMiddleware\]\)/);
  }
  assert.match(turn, /requireUserId/);
  assert.match(turn, /decideFetchSite/);
  assert.match(turn, /Forbidden: cross-site request blocked/);
  assert.match(turn, /request\.signal/);
  assert.match(turn, /relayModelStream/);
  const relay = readFileSync(new URL("../src/lib/mind/relay.ts", import.meta.url), "utf8");
  assert.match(relay, /signal: linked\.signal/);
  const agent = readFileSync(new URL("../src/lib/mind/agent-run.server.ts", import.meta.url), "utf8");
  assert.match(agent, /requireUserId/);
  assert.match(agent, /request\.signal/);
  assert.match(agent, /XAI_API_KEY/);
});
