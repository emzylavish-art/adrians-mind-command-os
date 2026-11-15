import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canBotRun, capabilitiesFor, FLEET_ACTIONS } from "./equal-capabilities.ts";

const BOTS = ["eve", "sol", "luna", "builder"];

describe("equal capabilities", () => {
  it("exports only the four paired actions", () => {
    assert.deepEqual(FLEET_ACTIONS, ["file_read", "file_write", "file_delete", "terminal"]);
  });

  it("returns that same list for every bot, including Eve", () => {
    const lists = BOTS.map((botId) => capabilitiesFor(botId));
    for (const list of lists) {
      assert.equal(list, FLEET_ACTIONS);
      assert.deepEqual(list, lists[0]);
    }
  });

  it("allows a paired action only when the approved string is that exact action", () => {
    for (const action of FLEET_ACTIONS) {
      for (const botId of BOTS) {
        const allowed = canBotRun({
          botId,
          action,
          approved: action,
          halted: false,
          actor: "owner",
        });
        assert.deepEqual(allowed, { ok: true });
      }
      const mismatched = canBotRun({
        botId: "eve",
        action,
        approved: action === "file_read" ? "file_write" : "file_read",
        halted: false,
        actor: "owner",
      });
      assert.equal(mismatched.ok, false);
    }
  });

  it("blocks all four when halted", () => {
    for (const action of FLEET_ACTIONS) {
      const decision = canBotRun({
        botId: "eve",
        action,
        approved: action,
        halted: true,
        actor: "owner",
      });
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.match(decision.reason, /stop/i);
    }
  });

  it("refuses when Eve tries to approve or halt", () => {
    for (const action of ["approve", "halt"]) {
      const decision = canBotRun({
        botId: "eve",
        action,
        approved: action,
        halted: false,
        actor: "eve",
      });
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.match(decision.reason, /Eve cannot/i);
    }
  });

  it("refuses mouse, keyboard, and browser", () => {
    for (const action of ["mouse", "keyboard", "browser", "browser pointer"]) {
      const decision = canBotRun({
        botId: "sol",
        action,
        approved: action,
        halted: false,
        actor: "owner",
      });
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.match(decision.reason, /blocked/i);
    }
  });
});
