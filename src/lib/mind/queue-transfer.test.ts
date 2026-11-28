import assert from "node:assert/strict";
import test from "node:test";
import { readTransferScope, transferableCue } from "./queue-transfer.ts";
import { CUE_LIMIT, receiveTransferredCue, type CuedMessage } from "./message-cue.ts";

const draft: CuedMessage = {
  id: "e210657b-89a8-4afd-926d-77f3dd2e1d49",
  text: "",
  paused: false,
  attachments: { images: [], file: { name: "notes.md", text: "Review notes" } },
};

test("transfer carries attachment-only content without execution permission", () => {
  const imported = transferableCue({ ...draft, dispatch: "anything" });
  assert.deepEqual(imported, { ...draft, paused: true });
  assert.equal(transferableCue({ ...draft, claimed: true }), null);
  assert.equal(transferableCue({ ...draft, text: "/build" }), null);
  assert.equal(transferableCue({ ...draft, attachmentsUnavailable: true }), null);
  assert.deepEqual(readTransferScope({ kind: "work", id: null, owner: "other" }), { kind: "work", id: null });
  assert.equal(readTransferScope({ kind: "chat", id: null }), null);
});

test("the local queue accepts one held draft and refuses a conflicting or overflowing import", () => {
  const imported = transferableCue(draft)!;
  const first = receiveTransferredCue([], imported)!;
  assert.equal(first[0].paused, true);
  assert.equal(receiveTransferredCue(first, imported), first);
  assert.equal(receiveTransferredCue(first, { ...imported, text: "different" }), null);
  const full = Array.from({ length: CUE_LIMIT }, (_, index) => ({ ...imported, id: String(index) }));
  assert.equal(receiveTransferredCue(full, imported), null);
});
