import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSingleFlight, runInFlight } from "./research-flight.ts";

type Cites = { title: string; url: string }[];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("chat research and Research-page check share one gate: no interleave, no stale overwrite", async () => {
  const flight = createSingleFlight();
  let shown: Cites = [];
  let calls = 0;
  const pageReply = deferred<Cites>();
  const chatReply = deferred<Cites>();
  const page = runInFlight(flight, async () => { calls += 1; shown = await pageReply.promise; });
  const chat = runInFlight(flight, async () => { calls += 1; shown = await chatReply.promise; });
  assert.deepEqual(await chat, { ran: false });
  pageReply.resolve([{ title: "new", url: "https://new.example" }]);
  chatReply.resolve([{ title: "stale", url: "https://stale.example" }]);
  assert.deepEqual(await page, { ran: true, value: undefined });
  assert.equal(calls, 1);
  assert.deepEqual(shown, [{ title: "new", url: "https://new.example" }]);
  assert.equal(flight.busy(), false);
});

test("a throwing research run releases the gate and rethrows", async () => {
  const flight = createSingleFlight();
  await assert.rejects(runInFlight(flight, async () => { throw new Error("provider down"); }), /provider down/);
  assert.equal(flight.busy(), false);
  const again = await runInFlight(flight, async () => 7);
  assert.deepEqual(again, { ran: true, value: 7 });
});

function body(src: string, sig: string) {
  const start = src.indexOf(sig);
  assert.ok(start > 0, sig);
  return src.slice(start, src.indexOf("\n  }\n", start));
}

test("command-app chat-intent runWebResearch goes through the Research single-flight gate", () => {
  const src = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
  const fn = body(src, "async function runWebResearch(");
  assert.match(fn, /researchFlight\.current\.begin\(\)/);
  assert.match(fn, /researchFlight\.current\.end\(/);
  assert.match(fn, /finally/);
  assert.match(fn, /already running/i);
  assert.match(fn, /setResearchBusy\(true\)/);
});

test("command-app chat research failure clears stale Research-page citations", () => {
  const src = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
  const fn = body(src, "async function runWebResearch(");
  const catchPart = fn.slice(fn.indexOf("catch"));
  assert.match(catchPart, /setResearchCitations\(\[\]\)/);
});
