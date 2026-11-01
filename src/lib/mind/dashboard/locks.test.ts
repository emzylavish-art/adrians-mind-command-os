import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLockText } from "./locks.ts";

describe("parseLockText", () => {
  it("parses owner, status, timestamps, commits, and block notes", () => {
    const text = `owner: Visual Polish Bot
branch: visual/polish-pass-5
status: done, released
claimed_at: 2026-11-01T12:43:41+01:00
released_at: 2026-11-01T12:55:23+01:00
commits:
  - 6832927 (pass-5 mount)
  - abcdef0 (extra)
notes: |
  Pass 5 complete.
  Notion primary 404; mirror appended.
`;
    const lock = parseLockText(text, "visual-polish.lock");
    assert.equal(lock.owner, "Visual Polish Bot");
    assert.equal(lock.branch, "visual/polish-pass-5");
    assert.equal(lock.status, "done, released");
    assert.equal(lock.claimed_at, "2026-11-01T12:43:41+01:00");
    assert.equal(lock.released_at, "2026-11-01T12:55:23+01:00");
    assert.deepEqual(lock.commits, ["6832927 (pass-5 mount)", "abcdef0 (extra)"]);
    assert.match(lock.notes, /Pass 5 complete/);
    assert.match(lock.notes, /Notion primary 404/);
  });

  it("accepts owner_bot / claimed_by aliases and strips Africa/Lagos paren", () => {
    const text = `owner_bot: Logic Bot
claimed_by: Logic Bot
timestamp: 2026-11-01T12:28:50+01:00 (Africa/Lagos)
released_at: 2026-11-01T12:34:46+01:00
status: done, released
`;
    const lock = parseLockText(text, "logic-wiring-gap.lock");
    assert.equal(lock.owner, "Logic Bot");
    assert.equal(lock.claimed_at, "2026-11-01T12:28:50+01:00");
  });
});
