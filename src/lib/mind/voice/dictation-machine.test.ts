import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDictationMachine,
  reduceDictation,
} from "./dictation-machine.ts";

describe("dictation state machine", () => {
  it("start -> stop -> inserted", () => {
    let state = createDictationMachine("Hello");
    state = reduceDictation(state, { type: "start" });
    assert.equal(state.phase, "recording");
    assert.match(state.status ?? "", /Dictation recording/);
    state = reduceDictation(state, { type: "level", level: 0.4 });
    state = reduceDictation(state, { type: "stop_begin" });
    assert.equal(state.phase, "transcribing");
    state = reduceDictation(state, { type: "stop_inserted", text: "world" });
    assert.equal(state.phase, "idle");
    assert.equal(state.draft, "Hello world");
    assert.match(state.status ?? "", /inserted/);
  });

  it("start -> cancel -> cleared", () => {
    let state = createDictationMachine("Keep");
    state = reduceDictation(state, { type: "start" });
    state = reduceDictation(state, { type: "cancel" });
    assert.equal(state.phase, "idle");
    assert.equal(state.draft, "Keep");
    assert.match(state.status ?? "", /cancelled/);
  });

  it("start -> toggle stops into transcribing", () => {
    let state = createDictationMachine("");
    state = reduceDictation(state, { type: "toggle" });
    assert.equal(state.phase, "recording");
    state = reduceDictation(state, { type: "toggle" });
    assert.equal(state.phase, "transcribing");
  });

  it("overlay_open cancels recording and clears status", () => {
    let state = createDictationMachine("x");
    state = reduceDictation(state, { type: "start" });
    state = reduceDictation(state, { type: "overlay_open" });
    assert.equal(state.phase, "idle");
    assert.equal(state.status, null);
    assert.equal(state.draft, "x");
  });

  it("silent or empty stop reports no speech detected", () => {
    let state = createDictationMachine("");
    state = reduceDictation(state, { type: "start" });
    state = reduceDictation(state, { type: "stop_begin" });
    state = reduceDictation(state, { type: "stop_silent" });
    assert.equal(state.phase, "idle");
    assert.match(state.status ?? "", /No speech detected/);

    state = reduceDictation(createDictationMachine(""), { type: "start" });
    state = reduceDictation(state, { type: "stop_begin" });
    state = reduceDictation(state, { type: "stop_empty" });
    assert.match(state.status ?? "", /No speech detected/);
  });
});
