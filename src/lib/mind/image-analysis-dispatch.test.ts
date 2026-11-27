import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runOwnerImageAnalysis } from "./image-analysis-dispatch.server.ts";
import type { MonetaryDispatchContext, MonetarySettlement } from "./financial-policy.ts";

const request = { name: "synthetic.jpg", bytes: 100, imageBase64: Buffer.concat([Buffer.from("ffd8ff", "hex"), Buffer.alloc(97)]).toString("base64"), operationId: "image-fixture", taskId: "task-fixture", projectId: "project-fixture" };
const fixtureFetch = async () => Response.json({ choices: [{ message: { content: "Synthetic visual answer." } }] });

test("legacy image RPC budget denial preserves exact identity and sends no image", async () => {
  let fetches = 0, settles = 0;
  const contexts: MonetaryDispatchContext[] = [];
  const result = await runOwnerImageAnalysis("owner-A", request, {
    visionKey: "fixture-key", isHalted: async () => false,
    fetch: async () => { fetches++; return fixtureFetch(); },
    dispatch: {
      reserve: async (owner, _sql, _now, context) => { assert.equal(owner, "owner-A"); contexts.push(context!); return { ok: false, error: "Review image estimate", status: 409, approvalId: "review-image" }; },
      settle: async () => { settles++; return { ok: true }; },
    },
  });
  assert.equal(result.ok, false); assert.equal(result.operationId, request.operationId);
  assert.equal("dispatched" in result && result.dispatched, false);
  assert.equal("approvalId" in result && result.approvalId, "review-image");
  assert.equal(fetches, 0); assert.equal(settles, 0);
  assert.equal(contexts[0].model, "gpt-4.1-mini"); assert.equal(contexts[0].provider, "openai");
  assert.equal(contexts[0].taskId, request.taskId); assert.equal(contexts[0].projectId, request.projectId);
  assert.match(contexts[0].requestHash!, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(contexts).includes(request.imageBase64), false);
});

test("free-only, missing credentials and invalid image bytes fail before any reservation", async () => {
  for (const [input, visionKey] of [[{ ...request, freeOnly: true }, "fixture-key"], [request, undefined], [{ ...request, bytes: 99 }, "fixture-key"]] as const) {
    let calls = 0;
    const result = await runOwnerImageAnalysis("owner-A", input, { visionKey, isHalted: async () => false,
      fetch: async () => { calls++; return fixtureFetch(); },
      dispatch: { reserve: async () => { calls++; return { ok: true }; }, settle: async () => { calls++; return { ok: true }; } },
    });
    assert.equal(result.ok, false); assert.equal(calls, 0);
    assert.equal("dispatched" in result && result.dispatched, false);
  }
});

test("a stop after reservation proves no dispatch and releases only that known-unsent hold", async () => {
  let halted = false, fetches = 0;
  const settlements: MonetarySettlement[] = [];
  const result = await runOwnerImageAnalysis("owner-A", request, { visionKey: "fixture-key", isHalted: async () => halted,
    fetch: async () => { fetches++; return fixtureFetch(); },
    dispatch: { reserve: async () => { halted = true; return { ok: true, reservationId: "held" }; }, settle: async (_owner, id, receipt) => { assert.equal(id, "held"); settlements.push(receipt); return { ok: true }; } },
  });
  assert.equal(result.ok, false); assert.equal(fetches, 0);
  assert.deepEqual(settlements, [{ outcome: "not_sent" }]);
  assert.equal("retryable" in result && result.retryable, false);
});

test("vision success and ambiguous failure never invent dollar amounts or no-dispatch evidence", async () => {
  for (const fail of [false, true]) {
    const settlements: MonetarySettlement[] = [];
    const result = await runOwnerImageAnalysis("owner-A", request, { visionKey: "fixture-key", isHalted: async () => false,
      fetch: async () => { if (fail) throw new TypeError("Connection ended after send"); return fixtureFetch(); },
      dispatch: { reserve: async () => ({ ok: true, reservationId: "held" }), settle: async (_owner, _id, receipt) => { settlements.push(receipt); return { ok: true }; } },
    });
    assert.equal(result.ok, !fail); assert.equal("dispatched" in result, false);
    assert.deepEqual(settlements, [{ outcome: fail ? "unknown" : "completed" }]);
  }
});

test("authenticated legacy image endpoint passes owner and exact request to the shared gate", () => {
  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  const route = server.slice(server.indexOf("export const analyzeImageFile"), server.indexOf("export const sendTurn"));
  assert.match(route, /middleware\(\[authMiddleware\]\)/);
  assert.match(route, /runOwnerImageAnalysis\(context\.userId, data/);
  assert.doesNotMatch(route, /return analyzeImage\(/);
});
