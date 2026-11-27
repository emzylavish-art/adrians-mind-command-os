import test from "node:test";
import assert from "node:assert/strict";
import { advanceVideoProgress, createVideoProgress, videoProgressMessage } from "./video-progress.ts";

const scope = { ownerId: "fixture-owner", session: "synthetic-login", chatId: "chat-a", operationId: "synthetic-operation" };

test("AA085 submitting cannot become accepted or ready without a provider handle", () => {
  const pending = createVideoProgress(scope);
  assert.match(videoProgressMessage(pending, scope)!, /^Submitting/);
  assert.throws(() => advanceVideoProgress(pending, "accepted"), /acceptance handle/);
  assert.throws(() => advanceVideoProgress(pending, "ready"), /acceptance handle/);
  const accepted = advanceVideoProgress(pending, "accepted", "synthetic-provider-job");
  assert.match(videoProgressMessage(accepted, scope)!, /accepted.*Rendering/);
  const retry = advanceVideoProgress(accepted, "retrying");
  assert.equal(retry.operationId, pending.operationId);
  assert.equal(retry.requestId, accepted.requestId);
  assert.match(videoProgressMessage(advanceVideoProgress(retry, "ready"), scope)!, /ready/);
  assert.equal(videoProgressMessage(null, scope), null, "Failure removes pending/accepted progress");
});

test("AA085/109 video progress belongs to the original chat and login instance", () => {
  const saved = createVideoProgress(scope, true);
  assert.match(videoProgressMessage(saved, scope)!, /saved video request/);
  assert.equal(videoProgressMessage(saved, { ...scope, chatId: "chat-b" }), null);
  assert.equal(videoProgressMessage(saved, { ...scope, ownerId: "other-owner" }), null);
  assert.equal(videoProgressMessage(saved, { ...scope, session: "fresh-same-owner-login" }), null);
});
