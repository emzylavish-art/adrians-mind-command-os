import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  publicPathLabel,
  publicizeDashboardStatus,
  redactSensitiveText,
} from "./status-publicize.ts";

describe("status-publicize (Gap#29)", () => {
  it("maps /workspace paths to repo-relative labels", () => {
    assert.equal(publicPathLabel("/workspace/locks/x.lock"), "locks/x.lock");
    assert.equal(publicPathLabel("/workspace/mind-command-os-logic"), "mind-command-os-logic");
    assert.equal(publicPathLabel(null), null);
  });

  it("redacts absolute paths and key-shaped tokens in prose", () => {
    const s = redactSensitiveText(
      "see /workspace/locks/voice-integration-merge-request.md token sk-abcdefghijklmnopqrstuvwxyz1234",
    );
    assert.match(s, /locks\/voice-integration-merge-request\.md/);
    assert.ok(!s.includes("/workspace"));
    assert.match(s, /\[redacted\]/);
  });

  it("redacts html-embedded /workspace paths without leading delimiter", () => {
    const s = redactSensitiveText("report <code>/workspace/mind-command-os-logic</code>");
    assert.ok(!s.includes("/workspace"));
    assert.match(s, /mind-command-os-logic/);
  });

  it("drops lock.raw and publicizes worktree", () => {
    const pub = publicizeDashboardStatus({
      bots: [
        {
          id: "logic",
          notes: "evidence /workspace/foo/bar.md",
          lock: {
            file: "logic-wiring.lock",
            owner: "logic",
            branch: "preview (worktree /workspace/mind-command-os-logic)",
            status: "claimed",
            claimed_at: "2026-11-01T12:00:00+01:00",
            released_at: null,
            commits: [],
            notes: "path /workspace/secrets/note.md",
            worktree: "/workspace/mind-command-os-logic",
            raw: { task: "do stuff", heartbeat_at: "2026-11-01T12:05:00+01:00", token: "sk-abcdefghijklmnopqrstuvwxyz1234" },
          },
        },
      ],
      sources: { locksDir: "/workspace/locks", repoDir: "/workspace/mind-command-os-dashboard" },
    });
    const bot = pub.bots[0]!;
    assert.equal(bot.lock!.worktree, "mind-command-os-logic");
    assert.equal("raw" in bot.lock!, false);
    assert.ok(!JSON.stringify(pub).includes("/workspace"));
    assert.equal(pub.sources.locksDir, "locks");
    assert.equal(pub.sources.repoDir, "mind-command-os-dashboard");
  });
});
