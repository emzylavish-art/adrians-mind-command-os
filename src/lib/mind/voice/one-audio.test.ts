import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSpeakTurn } from "./one-audio.ts";

describe("one speak path", () => {
  it("submits a finished turn once, speaks once, and drops audio after interrupt", () => {
    const speak = createSpeakTurn();
    const session = speak.start();
    assert.equal(speak.endTurn("  "), null);
    const turn = speak.endTurn("open the report");
    assert.equal(turn?.text, "open the report");
    assert.equal(speak.endTurn("again"), null);
    const token = speak.speak(session);
    assert.equal(typeof token, "number");
    assert.equal(speak.acceptAudio(token as number), true);
    assert.equal(speak.interrupt(), true);
    assert.equal(speak.acceptAudio(token as number), false);
    assert.equal(speak.phase(), "listening");
  });
});
