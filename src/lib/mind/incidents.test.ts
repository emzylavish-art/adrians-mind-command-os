import test from "node:test";
import assert from "node:assert/strict";
import { recordIncident, resolveIncident, retainIncidents, type Incident } from "./incidents.ts";
const incident = (id: string): Incident => ({ id, code: "provider_failure", target: id, message: "Unavailable", state: "open", at: "fixture", recovery: { strategy: "review", target: id, requiresFreshApproval: true } });
test("unresolved incidents survive activity retention and unrelated recovery", () => {
  const rows = Array.from({ length: 250 }, (_, i) => incident(String(i)));
  assert.equal(retainIncidents(rows).length, 250);
  const next = resolveIncident(rows, "249", "resolved");
  assert.equal(next.find((row) => row.id === "0")?.state, "open");
});
test("retry retains incident identity until verification and serializes a descriptor not a callback", () => {
  const pending = resolveIncident([incident("a")], "a", "recovering");
  const failed = recordIncident(pending, incident("a"));
  assert.equal(failed.length, 1); assert.equal(failed[0]?.state, "open");
  assert.deepEqual(JSON.parse(JSON.stringify(failed))[0].recovery, { strategy: "review", target: "a", requiresFreshApproval: true });
});
