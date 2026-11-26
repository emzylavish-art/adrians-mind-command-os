import assert from "node:assert/strict";
import test from "node:test";
import { createOwnedClientRuntime, clientPlatformAvailability, type ClientAdapter, type OwnedClientOperation } from "./client-runtime-contract.ts";
const operation: OwnedClientOperation = { id: "fixture-op-1", ownerId: "owner-a", workspaceId: "space-a", baseRevision: 2, kind: "conversation.append", payload: { text: "fixture message" } };
function fixture(surface: ClientAdapter["surface"]) {
  let owner: string | null = "owner-a"; let online = false; let calls = 0; const queues = new Map<string, OwnedClientOperation[]>();
  const adapter: ClientAdapter = { surface, currentOwner: () => owner, online: () => online, authorizedWorkspace: (user, workspace) => user === "owner-a" && workspace === "space-a", loadQueue: async user => structuredClone(queues.get(user) || []), saveQueue: async (user, queue) => { queues.set(user, structuredClone(queue)); }, send: async op => { calls++; return { id: op.id, ownerId: op.ownerId, workspaceId: op.workspaceId, revision: 3, state: "applied", detail: "synthetic adapter receipt" }; } };
  return { runtime: createOwnedClientRuntime(adapter), adapter, queues, setOwner: (value: string | null) => { owner = value; }, connect: () => { online = true; }, calls: () => calls };
}
test("the same synthetic operation keeps ownership/semantics across platform adapters", async () => {
  for (const surface of ["web", "windows", "ios", "android"] as const) {
    const f = fixture(surface); await f.runtime.enqueue(operation); assert.equal(f.calls(), 0); assert.deepEqual(await f.runtime.flush(), []); f.connect();
    const receipts = await f.runtime.flush(); assert.equal(receipts[0].state, "applied"); assert.equal(receipts[0].ownerId, "owner-a"); assert.equal(receipts[0].workspaceId, "space-a"); assert.equal(f.queues.get("owner-a")?.length, 0);
  }
  assert.equal(clientPlatformAvailability("ios").implementation, "unimplemented"); assert.equal(clientPlatformAvailability("android").nativeDeviceProof, "unverified");
});
test("queued operation never silently switches account/workspace when connectivity returns", async () => {
  const f = fixture("windows"); await f.runtime.enqueue(operation); f.setOwner("owner-b"); f.connect(); assert.deepEqual(await f.runtime.flush(), []); assert.equal(f.calls(), 0); assert.equal(f.queues.get("owner-a")?.length, 1);
  assert.equal((await f.runtime.enqueue({ ...operation, ownerId: "owner-b" })).state, "not_sent"); assert.equal(f.queues.has("owner-b"), false);
});
test("unknown outcome is durably held for reconciliation and cannot replay on next flush", async () => {
  const f = fixture("web"); let calls = 0; f.adapter.send = async () => { calls++; throw new Error("synthetic disconnect"); }; await f.runtime.enqueue(operation); f.connect();
  assert.equal((await f.runtime.flush())[0].state, "unknown"); assert.equal(f.queues.get("owner-a")?.[0].dispatchState, "needs-review"); assert.deepEqual(await f.runtime.flush(), []); assert.equal(calls, 1);
});
test("account switch during permission check prevents a queued write from dispatching", async () => {
  const f = fixture("windows"); await f.runtime.enqueue(operation); f.connect(); f.adapter.authorizedWorkspace = async () => { f.setOwner("owner-b"); return true; };
  assert.deepEqual(await f.runtime.flush(), []); assert.equal(f.calls(), 0);
});
