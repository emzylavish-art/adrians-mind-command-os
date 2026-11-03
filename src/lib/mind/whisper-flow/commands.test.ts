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

  it("maps delete that / scratch that / undo that to control commands", () => {
    const r = parseVoiceCommands("scratch that");
    assert.equal(r.commands[0]?.kind, "scratch_that");
    assert.equal(r.text, "");
    assert.equal(commandToInsert("scratch_that"), null);
    const undo = parseVoiceCommands("UNDO THAT");
    assert.equal(undo.commands[0]?.kind, "delete_that");
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

  it("accepts homophone / compound punctuation forms and casing variance", () => {
    const a = parseVoiceCommands("Hello FULLSTOP next");
    assert.equal(a.commands.some((c) => c.kind === "period"), true);
    const b = parseVoiceCommands("say questionmark now");
    assert.equal(b.commands.some((c) => c.kind === "question_mark"), true);
    const c = parseVoiceCommands("one New-Line two");
    assert.equal(c.commands.some((c) => c.kind === "new_line"), true);
  });

  it("parses punctuation commands mid-sentence", () => {
    const r = parseVoiceCommands("Hello period World comma ok");
    assert.deepEqual(
      r.commands.map((c) => c.kind),
      ["period", "comma"],
    );
    assert.equal(r.text, "Hello World ok");
  });

  it("does not treat bare pause inside a sentence as a command", () => {
    const r = parseVoiceCommands("please pause the video");
    assert.equal(r.commands.some((c) => c.kind === "pause"), false);
    assert.match(r.text, /pause the video/i);
  });

  it("treats trailing bare pause as a command", () => {
    const r = parseVoiceCommands("okay pause");
    assert.equal(r.commands.some((c) => c.kind === "pause"), true);
    assert.equal(r.text, "okay");
  });

  it("tucks punctuation without breaking non-Latin letters", () => {
    const r = parseVoiceCommands("こんにちは period мир");
    assert.equal(r.commands[0]?.kind, "period");
    assert.equal(r.text, "こんにちは мир");
  });
});
