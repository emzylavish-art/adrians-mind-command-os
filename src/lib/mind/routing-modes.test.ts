import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LogicRouteId } from "./logic-routes.ts";
import { planRouting, readRoutingMode, readRoutingPanel, saveRating, writeRoutingMode, writeRoutingPanel, type RouteSeat } from "./routing-modes.ts";

function memory() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function seat(id: LogicRouteId, ready: boolean): RouteSeat {
  return { id, label: id, ready, reason: ready ? "ready" : `${id} is not ready. Nothing was sent.` };
}

describe("routing modes", () => {
  it("keeps single-model mode on one call and does not merge", () => {
    const plan = planRouting({ mode: "A", primary: "sol", seats: [seat("sol", true), seat("astra", true)], panel: [] });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.calls.map((call) => call.route), ["sol"]);
    assert.equal(plan.merge, false);
  });

  it("blocks two-model mode until exactly two ready routes are selected", () => {
    const blocked = planRouting({ mode: "B", primary: null, seats: [seat("sol", true)], panel: ["sol"] });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.match(blocked.reason, /Nothing was sent/);
    const unready = planRouting({ mode: "B", primary: null, seats: [seat("sol", true), seat("luna", false)], panel: ["sol", "luna"] });
    assert.equal(unready.ok, false);
    const ready = planRouting({ mode: "B", primary: null, seats: [seat("sol", true), seat("astra", true)], panel: ["sol", "astra"] });
    assert.equal(ready.ok, true);
    if (!ready.ok) return;
    assert.deepEqual(ready.calls.map((call) => call.route), ["sol", "astra"]);
    assert.equal(ready.merge, false);
  });

  it("keeps panel and compare outputs separate", () => {
    const seats = [seat("astra", true), seat("sol", true), seat("luna", true)];
    const panel = planRouting({ mode: "C", primary: null, seats, panel: ["astra", "sol", "luna"] });
    const compare = planRouting({ mode: "D", primary: null, seats, panel: ["astra", "luna"] });
    assert.equal(panel.ok && panel.merge, false);
    assert.equal(compare.ok && compare.calls.length, 2);
  });

  it("persists the mode, the panel, and a 1–5 rating without dropping the model", () => {
    const storage = memory();
    writeRoutingMode(storage, "D");
    writeRoutingPanel(storage, ["astra", "sol"]);
    assert.equal(readRoutingMode(storage), "D");
    assert.deepEqual(readRoutingPanel(storage), ["astra", "sol"]);
    const saved = saveRating(storage, { messageId: "m1", score: 4, model: "grok-2", mode: "A", at: "2026-11-10T00:00:00.000Z" });
    assert.equal(saved[0]?.score, 4);
    assert.equal(saved[0]?.model, "grok-2");
  });
});
