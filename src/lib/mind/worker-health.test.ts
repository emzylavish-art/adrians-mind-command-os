import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretWorkerHealth } from "./worker-health.ts";

test("a future heartbeat cannot prove a worker is currently polling", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  const result = interpretWorkerHealth({ running: true, heartbeatAt: new Date(now + 600_000).toISOString() }, now, 90_000);
  assert.equal(result.state, "offline");
});
