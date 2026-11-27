import assert from "node:assert/strict";
import test from "node:test";
import { createChat, emptyWorkspace, normalizeWorkspace } from "./workspace.ts";
import { imageRetryPlan } from "./failure-states.ts";
import { chatTurnBody } from "./logic-routes.ts";
import { snapshotSpeakRetryParams } from "./voice/speak-action.ts";

test("image approval retry keeps its exact identity after workspace reload", () => {
  const operationId = "image:6cc298b1-8cc0-44f7-8c3b-1b2e687aee7f";
  const made = createChat(emptyWorkspace(), { memory: "off", autonomy: "ask", temporary: false, projectId: null });
  made.chat.messages = [
    { id: "prompt", role: "user", content: "/imagine a fictional tree", at: "", mediaOperationId: operationId },
    { id: "error", role: "assistant", kind: "error", content: "Review the exact cost ceiling", at: "" },
  ];
  const restored = normalizeWorkspace({ ...made.ws, chats: [made.chat] });
  const retry = imageRetryPlan(restored.chats[0].messages, made.chat.id);
  assert.equal(retry?.operationId, operationId);
  assert.equal(retry?.prompt, "a fictional tree");
  assert.equal(restored.chats[0].messages[0].deliveryOperationId, undefined);
});

test("turn project and shared task identities travel with the same immutable payload", () => {
  const body = chatTurnBody({ projectId: "project-a", taskId: "turn-a", chatId: "chat-a", text: "fixture", memory: "off", halted: false, history: [], memoryContext: [], provider: "openrouter", modelTier: "Auto", logicRoute: null, images: [] });
  assert.equal(body.projectId, "project-a"); assert.equal(body.taskId, "turn-a");
  assert.equal(body.chatId, "chat-a");
});

test("voice retry snapshots preserve a deliberately unscoped or selected project", () => {
  for (const projectId of [null, "project-a"]) {
    const input = { correlationId: "voice-a", projectId, text: "fixture reply", inputProvider: "openai", outputProvider: "custom:44fee7ec-8814-4c9a-b2c9-a6e73d0f1b7c" };
    const snapshot = snapshotSpeakRetryParams(input);
    input.projectId = "another-project";
    assert.equal(snapshot.projectId, projectId);
    assert.equal(snapshotSpeakRetryParams(snapshot).projectId, projectId);
    assert.equal(snapshot.correlationId, "voice-a");
  }
});
