import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRuntimeCapabilities, checkpointListOutcome } from "./runtime-capabilities.ts";

test("C1 AA036: account file access and runtime execution are distinct; missing and busy manifests never claim readiness", () => {
  const [account, unknown, ready, busy] = buildRuntimeCapabilities("owner", [
    { id: "A", label: "Unknown PC", fileProtocol: 2 },
    { id: "B", label: "Ready PC", capabilities: { fileProtocol: 2, codingRuntime: true, shell: true, busy: false } },
    { id: "C", label: "Busy PC", capabilities: { fileProtocol: 2, codingRuntime: true, shell: true, busy: true } },
  ]);
  assert.equal(account.files, true);
  for (const capability of ["coding", "shell", "git", "checkpoints", "debugger"] as const) assert.equal(account[capability], false);
  assert.equal(unknown.coding, false);
  assert.equal(ready.files, true);
  assert.equal(ready.coding, true);
  assert.equal(ready.git, false);
  assert.equal(busy.files, false);
  assert.equal(busy.coding, false);
  const local = buildRuntimeCapabilities("dev-user", [])[0];
  assert.equal(local.checkpoints, true);
  assert.equal(local.debugger, true);
});

test("C1 AA041: authorization, service and malformed checkpoint errors cannot become empty state", () => {
  assert.deepEqual(checkpointListOutcome(false, { ok: false, error: "Sign in is required." }), { ok: false, error: "Sign in is required." });
  assert.deepEqual(checkpointListOutcome(false, { ok: false, error: "Checkpoint service unavailable." }), { ok: false, error: "Checkpoint service unavailable." });
  assert.equal(checkpointListOutcome(true, { ok: true }).ok, false);
  assert.deepEqual(checkpointListOutcome(true, { ok: true, checkpoints: [] }), { ok: true, latest: null });
  assert.deepEqual(checkpointListOutcome(true, { ok: true, checkpoints: ["reviewed-checkpoint"] }), { ok: true, latest: "reviewed-checkpoint" });
});
