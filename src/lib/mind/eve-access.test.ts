import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eveAccessNotes } from "./eve-access.ts";

describe("eve access", () => {
  it("includes saved work and keeps the emergency stop out of her hands", () => {
    const notes = eveAccessNotes({
      chats: [{ title: "Build plan", messages: [{ content: "Keep the durable workspace." }] }],
      projects: [{ name: "Adrian OS" }],
      files: [{ name: "durable-proof.txt" }],
      connections: [{ label: "Grok", status: "server-configured" }],
      jobs: [{ name: "Night check", enabled: true }],
    });
    const text = notes.map((note) => note.text).join("\n");
    assert.match(text, /Build plan/);
    assert.match(text, /durable-proof.txt/);
    assert.match(text, /Grok server-configured/);
    assert.match(text, /owner-only/);
    assert.equal(/xai-|api[_-]?key|sk-/i.test(text), false);
    assert.equal(notes.some((note) => /turn it on|clear it/.test(note.text) && /cannot/.test(note.text)), true);
  });
});
