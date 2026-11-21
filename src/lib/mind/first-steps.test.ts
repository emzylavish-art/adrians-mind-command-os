import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FIRST_STEPS,
  dismissFirstSteps,
  nextFirstStep,
  previousFirstStep,
  readFirstSteps,
  reopenFirstSteps,
} from "./first-steps.ts";

describe("first steps", () => {
  it("starts at the first instruction when nothing is stored", () => {
    assert.deepEqual(readFirstSteps(null), { step: 0, dismissed: false });
    assert.equal(FIRST_STEPS[0]?.id, "ask");
  });

  it("moves forward and back without leaving the list", () => {
    const start = readFirstSteps(null);
    const second = nextFirstStep(start);
    assert.equal(second.step, 1);
    assert.equal(previousFirstStep(second).step, 0);
    assert.equal(previousFirstStep(start).step, 0);
  });

  it("dismisses on the last next and can be opened again", () => {
    let state = readFirstSteps(null);
    for (let index = 0; index < FIRST_STEPS.length - 1; index += 1) state = nextFirstStep(state);
    assert.equal(state.dismissed, false);
    assert.equal(state.step, FIRST_STEPS.length - 1);
    assert.equal(nextFirstStep(state).dismissed, true);
    assert.equal(dismissFirstSteps(startState()).dismissed, true);
    assert.deepEqual(reopenFirstSteps(), { step: 0, dismissed: false });
  });

  it("ignores a broken stored value", () => {
    assert.deepEqual(readFirstSteps("{"), { step: 0, dismissed: false });
    assert.equal(readFirstSteps(JSON.stringify({ step: 99, dismissed: false })).step, FIRST_STEPS.length - 1);
  });
});

function startState() {
  return readFirstSteps(null);
}
