import assert from "node:assert/strict";
import test from "node:test";
import { runNativeDeviceRequest } from "./native-device-client.ts";
const input = { ownerId: "fixture-owner", localEnabled: true, halted: false, text: "list windows" };
test("native device UI sends only explicit current-device request and preserves refusal receipt", async () => {
  let sent: unknown;
  const result = await runNativeDeviceRequest(input, async (_url, init) => { sent = JSON.parse(String(init?.body)); return Response.json({ recognized: true, authorized: false, attempted: false, ran: false, completed: false, verified: false, state: "blocked", output: "Emergency stop is on", receipts: [], destination: { kind: "local", deviceId: "fixture-device" } }, { status: 409 }); });
  assert.deepEqual(sent, { text: "list windows", destination: "current-device" }); assert.equal(result.state, "receipt"); if (result.state === "receipt") assert.equal(result.receipt.attempted, false);
});
test("unavailable, halted, missing owner and unapproved screenshot do not dispatch", async () => {
  let calls = 0;
  for (const request of [{ ...input, localEnabled: false }, { ...input, ownerId: null }, { ...input, halted: true }, { ...input, text: "understand the screenshot" }]) {
    const result = await runNativeDeviceRequest(request, async () => { calls++; return Response.json({}); }); assert.equal(result.state, "not_sent");
  }
  assert.equal(calls, 0);
});
test("native UI failure is unknown with exactly one attempt and never automatic retry", async () => {
  let calls = 0;
  const result = await runNativeDeviceRequest(input, async () => { calls++; throw new Error("fixture disconnect"); }); assert.equal(result.state, "unknown"); assert.equal(calls, 1);
});
