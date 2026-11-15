import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sharedMemory, type WorkspaceNote } from "./shared-memory.ts";

const notes: WorkspaceNote[] = [
  { title: "Workspace", body: "Eve and the bots share the hosted notes." },
  { title: "API key location", body: "Keep this out of the shared view." },
  { title: "Login", body: "The password stays with the owner." },
  { title: "Session token", body: "Not for the fleet." },
  { title: "Secret plan", body: "Do not share this title." },
];

describe("sharedMemory", () => {
  it("returns the same filtered notes for every bot id", () => {
    const view = sharedMemory(notes, ["eve", "sol", "luna"]);
    assert.equal(view.eve, view.sol);
    assert.equal(view.sol, view.luna);
    assert.deepEqual(
      view.eve.map((note) => note.title),
      ["Workspace"],
    );
    assert.equal(view.eve[0]?.body.includes("share the hosted notes"), true);
  });

  it("drops secret, api key, token, and password notes without a second store", () => {
    const before = notes.length;
    const first = sharedMemory(notes, ["eve"]);
    const second = sharedMemory(notes, ["builder"]);
    assert.equal(notes.length, before);
    assert.equal("sol" in first, false);
    assert.equal("eve" in second, false);
    assert.equal(first.eve.some((note) => /secret|api key|token|password/i.test(`${note.title} ${note.body}`)), false);
    assert.deepEqual(first.eve, second.builder);
  });
});
