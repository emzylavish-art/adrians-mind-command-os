import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commandToInsert, parseVoiceCommands } from "./commands.ts";

describe("whisper-flow voice commands", () => {
  it("strips new line / paragraph and punctuation commands from text", () => {
    const r = parseVoiceCommands("hello new line world period");
    assert.deepEqual(
      r.commands.map((c) => c.kind),
      ["new_line", "period"],
    );
    assert.equal(r.text, "hello world");
    assert.equal(commandToInsert("new_line"), "\n");
    assert.equal(commandToInsert("period"), ".");
  });

  it("recognizes pause resume stop without inserting them", () => {
    const r = parseVoiceCommands("pause dictation");
    assert.equal(r.text, "");
    assert.equal(r.commands[0]?.kind, "pause");
    const stop = parseVoiceCommands("please stop dictation");
    assert.equal(stop.commands.some((c) => c.kind === "stop"), true);
    assert.equal(stop.text, "please");
  });

  it("maps delete that / scratch that to control commands", () => {
    const r = parseVoiceCommands("scratch that");
    assert.equal(r.commands[0]?.kind, "scratch_that");
    assert.equal(r.text, "");
    assert.equal(commandToInsert("scratch_that"), null);
  });

  it("does not treat send or submit as commands", () => {
    const r = parseVoiceCommands("please send this submit now");
    assert.equal(r.commands.length, 0);
    assert.match(r.text, /send/);
    assert.match(r.text, /submit/);
  });

  it("handles comma and question mark", () => {
    const r = parseVoiceCommands("ready comma set question mark");
    assert.deepEqual(
      r.commands.map((c) => c.kind),
      ["comma", "question_mark"],
    );
    assert.equal(r.text, "ready set");
  });
});
