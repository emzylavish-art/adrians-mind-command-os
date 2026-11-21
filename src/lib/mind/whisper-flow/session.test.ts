import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { processDictationSegment } from "./session.ts";

describe("whisper-flow session segment pipeline", () => {
  it("parses commands then refines remaining prose", () => {
    const r = processDictationSegment("um hello new line world period");
    assert.ok(r.insertPieces.includes("\n"));
    assert.ok(r.insertPieces.includes("."));
    assert.ok(r.insertPieces.some((p) => /Hello/i.test(p) || /World/i.test(p) || /hello/i.test(p)));
    assert.equal(r.commands.some((c) => c.kind === "new_line"), true);
  });

  it("scratch that discards without insertable prose", () => {
    const r = processDictationSegment("scratch that");
    assert.equal(r.discardSegment, true);
    assert.equal(r.insertPieces.length, 0);
  });

  it("never treats send as a submit command", () => {
    const r = processDictationSegment("please send the report");
    assert.equal(r.commands.length, 0);
    assert.match(r.insertPieces.join(" "), /send the report/i);
  });
});
