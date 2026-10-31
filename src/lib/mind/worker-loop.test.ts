import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWorkerLoop } from "./worker-loop.ts";
import { interpretWorkerHealth } from "./worker-health.ts";

describe("worker loop", () => {
  it("runs passes one at a time and stops without another pass", async () => {
    let running = 0;
    let maxRunning = 0;
    const logs: string[] = [];
    const loop = createWorkerLoop({
      log: (event) => logs.push(event),
      runPass: async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        running -= 1;
      },
    });
    const first = loop.iteration();
    const extra = await loop.iteration();
    assert.equal(extra, "overlapped");
    assert.equal(await first, "ran");
    assert.equal(maxRunning, 1);
    loop.stop();
    assert.equal(await loop.iteration(), "stopped");
    assert.equal(loop.passes, 1);
    assert.deepEqual(logs, ["overlap", "pass", "shutdown"]);
  });

  it("reads a local heartbeat and does not treat a stale or hosted flag as online", () => {
    const now = Date.parse("2026-04-01T12:00:00.000Z");
    const fresh = interpretWorkerHealth({ running: true, heartbeatAt: "2026-04-01T11:59:30.000Z", hosted: true }, now, 60_000);
    assert.equal(fresh.state, "local");
    assert.equal(fresh.hosted, false);
    const stale = interpretWorkerHealth({ running: true, heartbeatAt: "2026-04-01T11:00:00.000Z" }, now, 60_000);
    assert.equal(stale.state, "offline");
    const oneShot = interpretWorkerHealth({ running: false, heartbeatAt: "2026-04-01T11:59:30.000Z" }, now, 60_000);
    assert.equal(oneShot.state, "offline");
    assert.match(interpretWorkerHealth(null, now, 60_000).detail, /Nothing is running/);
  });
});
