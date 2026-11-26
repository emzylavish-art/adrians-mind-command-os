import assert from "node:assert/strict";
import test from "node:test";
import { dismissRecovery, failureKindForAction, recoveryKind, readRecoveries, serializeRecoveries, upsertRecovery, type RecoveryEntry } from "./recovery-inbox.ts";
test("independent failures remain addressable and older recovery cannot clear another operation", () => { const a: RecoveryEntry = { auditId: "a", target: "chat1", operationId: "send1", createdAt: "", message: "timeout", retry: () => { throw Error("must not run"); }, kind: "chat_timeout" }; const b = { ...a, auditId: "b", target: "search", operationId: "search1" }; const rows = upsertRecovery(upsertRecovery([], a), b); assert.equal(rows.length, 2); assert.deepEqual(dismissRecovery(rows, "a").map((row) => row.auditId), ["b"]); assert.deepEqual(dismissRecovery(rows, "unknown"), rows); const restored = readRecoveries(serializeRecoveries(rows)); assert.equal(restored[1].operationId, "send1"); assert.ok(restored.every((row) => row.retry === null)); });
test("typed action classification does not depend on copy wording", () => { assert.equal(failureKindForAction("session_rejected"), "auth_required"); assert.equal(failureKindForAction("research_failed"), "research_failed"); assert.equal(failureKindForAction("unknown"), null); });

test("structured turn errors remain stable across localized or misleading copy", () => {
  for (const text of ["Sign in is required", "La réponse est indisponible", "Rate limited; check your account"]) {
    assert.equal(recoveryKind("unknown", text, failureKindForAction("unknown")), null);
    assert.equal(recoveryKind("service_unavailable", text, failureKindForAction("service_unavailable")), "network_failure");
    assert.equal(recoveryKind("provider_credentials_rejected", text, failureKindForAction("provider_credentials_rejected")), "model_unavailable");
    assert.equal(recoveryKind("auth_required", text, failureKindForAction("auth_required")), "auth_required");
  }
});
