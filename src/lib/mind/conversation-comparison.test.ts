import assert from "node:assert/strict";
import { test } from "node:test";
import { comparisonPassages, comparisonSourceCurrent, consolidateInvestigations, newComparisonReview } from "./conversation-comparison.ts";
import type { Chat } from "./types.ts";

const AT = "2026-11-26T12:00:00.000Z";
function chat(id: string, content: string): Chat {
  return { id, title: `${id} investigation`, memory: "off", temporary: false, autonomy: "ask", projectId: null, retrievalLog: [], messages: [{ id: `${id}-reply`, role: "assistant", content, at: AT, provider: "fixture-provider", model: "fixture-model" }] };
}
function candidates(chats: Chat[]) {
  const result = comparisonPassages(chats, chats.map((item) => item.id));
  if (!result.ok) throw Error(result.error);
  return result.passages;
}

test("three investigations consolidate overlapping and contradictory findings without losing provenance or uncertainty", () => {
  const shared = "Preserve the original file before preview extraction.";
  const chats = [chat("design", shared + "\n\nUse queued release execution."), chat("architecture", shared + "\n\nUse direct release execution."), chat("reliability", "The old client may retry after restart.\n\nVerify cancellation after reconnect.")];
  const before = JSON.stringify(chats);
  const reviews = candidates(chats).map((source) => {
    const review = newComparisonReview(source);
    if (source.text === shared) return { ...review, proof: "confirmed" as const, evidence: "Controlled local original-byte round-trip fixture passed; no live provider claim." };
    if (source.text.includes("release execution")) return { ...review, proof: "proposal" as const, topic: "Release execution", position: source.text.includes("queued") ? "Queued" : "Direct" };
    return { ...review, proof: "hypothesis" as const, verificationNeeded: "Use a two-tab restart fixture before changing retry behavior." };
  });
  const result = consolidateInvestigations(chats, reviews);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.blueprint.reviews.length, 6);
  assert.equal(result.blueprint.duplicates.length, 1);
  assert.equal(result.blueprint.duplicates[0].passageIds.length, 2);
  assert.equal(result.blueprint.disagreements.length, 1);
  assert.deepEqual(result.blueprint.disagreements[0].positions.map((entry) => entry.position), ["Queued", "Direct"]);
  assert.equal(result.blueprint.outstanding.length, 2);
  for (const source of reviews.map((review) => review.source)) {
    assert.ok(result.blueprint.markdown.includes(`chat ${source.chatId}`));
    assert.ok(result.blueprint.markdown.includes(`message ${source.messageId}`));
    assert.ok(result.blueprint.markdown.includes(`characters ${source.start}–${source.end}`));
  }
  assert.match(result.blueprint.markdown, /\?section=chat&chat=design/);
  assert.match(result.blueprint.markdown, /Owner-confirmed findings with evidence/);
  assert.match(result.blueprint.markdown, /## Proposals/);
  assert.match(result.blueprint.markdown, /## Hypotheses/);
  assert.match(result.blueprint.markdown, /No position was selected automatically/);
  assert.equal(JSON.stringify(chats), before);
});

test("reviewed text cannot be exported after source deletion, modification or selected-answer change", () => {
  const chats = [chat("one", "First conclusion."), chat("two", "Second conclusion.")];
  chats[0].messages[0].selectedReplyVersionId = "version-one";
  const reviews = candidates(chats).map(newComparisonReview);
  assert.equal(consolidateInvestigations(chats, reviews).ok, true);
  assert.equal(consolidateInvestigations(chats.slice(1), reviews).ok, false);
  const changed = structuredClone(chats); changed[0].messages[0].content = "Other conclusion.";
  assert.equal(comparisonSourceCurrent(changed, reviews[0].source), false);
  assert.equal(consolidateInvestigations(changed, reviews).ok, false);
  const versioned = structuredClone(chats); versioned[0].messages[0].selectedReplyVersionId = "version-two";
  assert.equal(consolidateInvestigations(versioned, reviews).ok, false);
});

test("a generated claim defaults to unreviewed and owner confirmation requires an explicit evidence note", () => {
  const chats = [chat("one", "Certainly all tests passed."), chat("two", "Deployment is ready.")];
  const reviews = candidates(chats).map(newComparisonReview);
  assert.ok(reviews.every((review) => review.proof === "unreviewed" && !review.evidence));
  const initial = consolidateInvestigations(chats, reviews);
  assert.equal(initial.ok, true); if (initial.ok) assert.equal(initial.blueprint.outstanding.length, 2);
  reviews[0].proof = "confirmed";
  const unsupported = consolidateInvestigations(chats, reviews);
  assert.equal(unsupported.ok, false); if (!unsupported.ok) assert.match(unsupported.error, /evidence note/);
});

test("temporary, user partial output and failed assistant text never become comparison evidence", () => {
  const chats = [chat("one", "Completed finding."), chat("two", "Second completed finding.")];
  chats[0].messages.push({ id: "user", role: "user", content: "A request", partialReply: "Incomplete result", delivery: "stopped", at: AT }, { id: "error", role: "assistant", content: "A failure is not a finding", kind: "error", at: AT });
  assert.deepEqual(candidates(chats).map((source) => source.text), ["Completed finding.", "Second completed finding."]);
  chats[1].temporary = true;
  const blocked = comparisonPassages(chats, ["one", "two"]);
  assert.equal(blocked.ok, false); if (!blocked.ok) assert.match(blocked.error, /temporary/);
});

test("oversized comparison selection returns an explicit capacity error rather than dropping findings", () => {
  const chats = [chat("one", Array.from({ length: 120 }, (_, i) => `Finding ${i}`).join("\n\n")), chat("two", "Final acceptance requirement")];
  const result = comparisonPassages(chats, ["one", "two"]);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /no passages were silently discarded/);
});

test("exact duplicate grouping does not collapse indentation-sensitive code into a false agreement", () => {
  const chats = [chat("one", "if ready:\n    release()\n    archive()"), chat("two", "if ready:\n    release()\narchive()")];
  const result = consolidateInvestigations(chats, candidates(chats).map(newComparisonReview));
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.blueprint.duplicates.length, 0);
  assert.match(result.blueprint.markdown, /does not establish semantic uniqueness/);
});
